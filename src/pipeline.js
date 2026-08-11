const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const YAML = require("yaml");
const { activePipelines, deploymentsTotal, pipelineDuration } = require("./metrics");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_EVENT_LOG_CHARS = 15000;

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const trimmed = output.trim();
      if (code === 0) resolve(trimmed);
      else reject(new Error(trimmed || `${command} exited with ${code}`));
    });
  });
}

class PipelineRunner {
  constructor({ store, config, logger = console }) {
    this.store = store;
    this.config = config;
    this.logger = logger;
  }

  async run(deployment) {
    const started = Date.now();
    const context = {
      deployment,
      workdir: null,
      repoDir: null,
      plan: null,
      imageRepository: deployment.image_tag.split(":")[0],
      imageTag: deployment.image_tag.split(":")[1] || deployment.commit_sha.slice(0, 12),
      releaseName: this.releaseName(deployment),
      namespace: this.config.kubeNamespace,
      containerPort: 80,
      imagePullPolicy: this.config.pushImages ? "IfNotPresent" : "Never"
    };

    activePipelines.inc();
    await this.store.updateDeployment(deployment.id, { status: "running" });
    this.logger.info({ deploymentId: deployment.id }, "pipeline started");

    try {
      if (this.config.pipelineMode === "real") {
        await this.runRealPipeline(context);
      } else {
        await this.runSimulatedPipeline(context);
      }

      const finished = await this.store.updateDeployment(deployment.id, {
        status: "deployed",
        release_name: context.releaseName,
        namespace: context.namespace,
        deployed_at: new Date()
      });
      deploymentsTotal.inc({ status: "deployed", environment: deployment.environment });
      pipelineDuration.observe({ status: "deployed", environment: deployment.environment }, (Date.now() - started) / 1000);
      this.logger.info({ deploymentId: deployment.id }, "pipeline deployed");
      return finished;
    } catch (error) {
      await this.store.addEvent(deployment.id, "pipeline", "failed", error.message.slice(0, 2000));
      const failed = await this.store.updateDeployment(deployment.id, { status: "failed" });
      deploymentsTotal.inc({ status: "failed", environment: deployment.environment });
      pipelineDuration.observe({ status: "failed", environment: deployment.environment }, (Date.now() - started) / 1000);
      this.logger.error({ error, deploymentId: deployment.id }, "pipeline failed");
      return failed;
    } finally {
      activePipelines.dec();
      if (context.workdir) {
        fs.rmSync(context.workdir, { recursive: true, force: true });
      }
    }
  }

  async runSimulatedPipeline(context) {
    const { deployment } = context;
    await this.stage(deployment.id, "checkout", async () => sleep(350), "Cloned repository metadata");
    await this.stage(deployment.id, "test", async () => sleep(350), "Automated test suite passed");
    await this.stage(deployment.id, "build", async () => sleep(350), `Built Docker image ${deployment.image_tag}`);
    await this.stage(deployment.id, "scan", async () => sleep(350), "Security scan completed");
    await this.stage(deployment.id, "push", async () => sleep(350), `Pushed image to ${this.config.dockerRegistry}`);
    await this.stage(deployment.id, "deploy", async () => sleep(350), `Released with Helm into ${this.config.kubeNamespace}`);
  }

  async runRealPipeline(context) {
    const { deployment } = context;

    await this.stage(deployment.id, "checkout", async () => {
      context.workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cicd-"));
      context.repoDir = path.join(context.workdir, "repo");
      await runCommand("git", ["clone", "--depth", "1", "--branch", deployment.branch, this.repositoryUrl(deployment.repository), context.repoDir]);
      await runCommand("git", ["fetch", "--depth", "1", "origin", deployment.commit_sha], { cwd: context.repoDir }).catch(() => "");
      await runCommand("git", ["checkout", deployment.commit_sha], { cwd: context.repoDir });
    }, `Cloned ${deployment.repository}@${deployment.commit_sha.slice(0, 7)}`);

    await this.stage(deployment.id, "test", async () => {
      const result = await this.runDetectedTests(context.repoDir);
      if (result) await this.store.addEvent(deployment.id, "test", "succeeded", result);
    }, "Repository checks completed");

    await this.stage(deployment.id, "build", async () => {
      context.plan = this.prepareBuildPlan(context);
      if (context.plan.type === "compose") {
        const outputs = [];
        for (const service of context.plan.services.filter((item) => item.build)) {
          outputs.push(await runCommand("docker", ["build", "-f", service.dockerfile, "-t", service.image, service.context]));
        }
        return outputs.join("\n\n");
      }

      context.containerPort = context.plan.containerPort;
      return runCommand("docker", ["build", "-f", context.plan.dockerfile, "-t", this.fullImageName(context), context.repoDir]);
    }, () => this.buildSuccessMessage(context));

    await this.stage(deployment.id, "scan", async () => this.runSecurityScan(context), () => this.scanSuccessMessage(context));

    await this.stage(deployment.id, "push", async () => {
      if (!this.config.pushImages) {
        return;
      }
      if (context.plan.type === "compose") {
        const outputs = [];
        for (const service of context.plan.services.filter((item) => item.build)) {
          outputs.push(await runCommand("docker", ["push", service.image]));
        }
        return outputs.join("\n\n");
      }
      return runCommand("docker", ["push", this.fullImageName(context)]);
    }, () => this.pushSuccessMessage(context));

    await this.stage(deployment.id, "deploy", async () => {
      context.namespace = this.targetNamespace(context);
      await runCommand("kubectl", ["create", "namespace", context.namespace], { env: this.kubeEnv() }).catch(() => "");

      if (context.plan.type === "compose") {
        const valuesFile = path.join(context.workdir, "compose-values.yaml");
        fs.writeFileSync(valuesFile, YAML.stringify({
          services: context.plan.services.map((service) => ({
            name: service.name,
            image: service.imageForHelm,
            port: service.port,
            env: service.env,
            readinessPath: service.readinessPath || "",
            livenessPath: service.livenessPath || ""
          }))
        }));

        await runCommand("helm", [
          "upgrade",
          "--install",
          context.releaseName,
          "./helm/compose-app",
          "--namespace",
          context.namespace,
          "-f",
          valuesFile
        ], { env: this.kubeEnv() });

        const outputs = [];
        for (const service of context.plan.services) {
          outputs.push(await runCommand("kubectl", [
            "-n",
            context.namespace,
            "rollout",
            "status",
            `deployment/${service.name}`,
            "--timeout=120s"
          ], { env: this.kubeEnv() }));
        }
        return outputs.join("\n");
      }

      await runCommand("helm", [
        "upgrade",
        "--install",
        context.releaseName,
        this.config.appChartPath,
        "--namespace",
        context.namespace,
        "--set",
        `image.repository=${this.imageRepositoryForHelm(context)}`,
        "--set",
        `image.tag=${context.imageTag}`,
        "--set",
        `image.pullPolicy=${context.imagePullPolicy}`,
        "--set",
        `containerPort=${context.containerPort}`
      ], { env: this.kubeEnv() });

      return runCommand("kubectl", [
        "-n",
        context.namespace,
        "rollout",
        "status",
        `deployment/${context.releaseName}-deployed-app`,
        "--timeout=120s"
      ], { env: this.kubeEnv() });
    }, () => `Deployed ${context.releaseName} to Kubernetes namespace ${context.namespace}`);
  }

  async rollback(deployment) {
    const context = {
      deployment,
      releaseName: this.releaseName(deployment),
      namespace: this.rollbackNamespace(deployment)
    };

    await this.store.addEvent(deployment.id, "rollback", "running", `Rolling back Helm release ${context.releaseName}`);
    try {
      const output = await runCommand("helm", [
        "rollback",
        context.releaseName,
        "--namespace",
        context.namespace
      ], { env: this.kubeEnv() });
      await this.store.addEvent(deployment.id, "rollback", "succeeded", `Rolled back ${context.releaseName} in namespace ${context.namespace}`, output);
      return this.store.updateDeployment(deployment.id, { status: "rolled_back" });
    } catch (error) {
      await this.store.addEvent(deployment.id, "rollback", "failed", error.message.slice(0, 2000), error.message);
      throw error;
    }
  }

  async stage(deploymentId, stage, operation, successMessage) {
    await this.store.addEvent(deploymentId, stage, "running", `${stage} started`);
    this.logger.info({ deploymentId, stage }, "pipeline stage started");
    const logs = await operation();
    const message = typeof successMessage === "function" ? successMessage() : successMessage;
    await this.store.addEvent(deploymentId, stage, "succeeded", message, truncateLogs(logs || ""));
    this.logger.info({ deploymentId, stage }, "pipeline stage succeeded");
  }

  async runDetectedTests(repoDir) {
    if (fs.existsSync(path.join(repoDir, "package.json"))) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(repoDir, "package.json"), "utf8"));
      const installCommand = fs.existsSync(path.join(repoDir, "package-lock.json")) ? "ci" : "install";
      await runCommand("npm", [installCommand], { cwd: repoDir });
      if (packageJson.scripts?.test) {
        await runCommand("npm", ["test"], { cwd: repoDir });
        return "npm test passed";
      }
      return "npm dependencies installed; no test script defined";
    }

    if (fs.existsSync(path.join(repoDir, "go.mod"))) {
      await runCommand("go", ["test", "./..."], { cwd: repoDir });
      return "go test ./... passed";
    }

    const packageDirs = findPackageDirs(repoDir);
    const results = [];
    for (const packageDir of packageDirs) {
      const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
      const installCommand = fs.existsSync(path.join(packageDir, "package-lock.json")) ? "ci" : "install";
      await runCommand("npm", [installCommand], { cwd: packageDir });
      if (packageJson.scripts?.test) {
        await runCommand("npm", ["test"], { cwd: packageDir });
        results.push(`${path.relative(repoDir, packageDir)} npm test passed`);
      } else {
        results.push(`${path.relative(repoDir, packageDir)} dependencies installed; no test script defined`);
      }
    }
    if (results.length > 0) return results.join("; ");

    return "No automated test command detected; continuing";
  }

  prepareBuildPlan(context) {
    const composeFile = path.join(context.repoDir, "docker-compose.yml");
    if (fs.existsSync(composeFile)) {
      const composePlan = this.prepareComposeBuild(context, composeFile);
      if (composePlan.services.some((service) => service.build)) return composePlan;
    }

    return this.prepareSingleImageBuild(context.repoDir);
  }

  prepareSingleImageBuild(repoDir) {
    const existingDockerfile = path.join(repoDir, "Dockerfile");
    if (fs.existsSync(existingDockerfile)) {
      return { type: "single", dockerfile: existingDockerfile, containerPort: 3000 };
    }

    if (fs.existsSync(path.join(repoDir, "package.json"))) {
      const dockerfile = path.join(repoDir, ".cicd.Dockerfile");
      fs.writeFileSync(dockerfile, nodeDockerfile());
      return { type: "single", dockerfile, containerPort: 3000 };
    }

    if (fs.existsSync(path.join(repoDir, "index.html"))) {
      const dockerfile = path.join(repoDir, ".cicd.Dockerfile");
      fs.writeFileSync(dockerfile, staticDockerfile());
      return { type: "single", dockerfile, containerPort: 80 };
    }

    throw new Error("No Dockerfile, package.json, index.html, or supported docker-compose.yml build services found. Cannot infer how to containerize this repository.");
  }

  prepareComposeBuild(context, composeFile) {
    const compose = YAML.parse(fs.readFileSync(composeFile, "utf8"));
    const services = Object.entries(compose.services || {})
      .filter(([name, service]) => service.build || supportedComposeImage(service.image))
      .map(([name, service]) => this.composeServicePlan(context, name, service));

    if (services.length === 0) {
      throw new Error("docker-compose.yml did not contain buildable services or supported backing images.");
    }

    return { type: "compose", services };
  }

  composeServicePlan(context, name, service) {
    const build = normalizeComposeBuild(service.build);
    const imageRepository = build ? this.composeImageRepository(context, name) : splitImage(String(service.image || "")).repository;
    const imageTag = build ? context.imageTag : splitImage(String(service.image || "")).tag;
    const image = `${imageRepository}:${imageTag}`;
    const port = firstContainerPort(service) || defaultPortForService(name, service.image);

    return {
      name: sanitizeKubernetesName(name),
      build: Boolean(build),
      context: build ? path.resolve(context.repoDir, build.context) : null,
      dockerfile: build ? path.resolve(context.repoDir, build.context, build.dockerfile) : null,
      image,
      imageForHelm: {
        repository: imageRepository,
        tag: imageTag,
        pullPolicy: build ? context.imagePullPolicy : "IfNotPresent"
      },
      port,
      env: normalizeEnvironment(service.environment),
      readinessPath: readinessPathForService(name),
      livenessPath: readinessPathForService(name)
    };
  }

  repositoryUrl(repository) {
    if (/^https?:\/\//.test(repository)) return repository;
    const cleanRepo = repository.replace(/^\/+|\/+$/g, "");
    if (this.config.gitAuthToken) {
      return `https://x-access-token:${this.config.gitAuthToken}@github.com/${cleanRepo}.git`;
    }
    return `https://github.com/${cleanRepo}.git`;
  }

  fullImageName(context) {
    const repository = this.imageRepositoryForHelm(context);
    return `${repository}:${context.imageTag}`;
  }

  imageRepositoryForHelm(context) {
    if (!this.config.dockerRegistry || this.config.dockerRegistry === "local") {
      return context.imageRepository;
    }
    return `${this.config.dockerRegistry.replace(/\/$/g, "")}/${context.imageRepository}`;
  }

  composeImageRepository(context, serviceName) {
    const repository = `${context.imageRepository}-${sanitizeKubernetesName(serviceName)}`;
    if (!this.config.dockerRegistry || this.config.dockerRegistry === "local") {
      return repository;
    }
    return `${this.config.dockerRegistry.replace(/\/$/g, "")}/${repository}`;
  }

  buildSuccessMessage(context) {
    if (context.plan?.type === "compose") {
      const images = context.plan.services.filter((service) => service.build).map((service) => service.image).join(", ");
      return `Built Compose service images ${images}`;
    }
    return `Built Docker image ${this.fullImageName(context)}`;
  }

  pushSuccessMessage(context) {
    if (!this.config.pushImages) return "Image push skipped; using local Docker Desktop image store";
    if (context.plan?.type === "compose") {
      const images = context.plan.services.filter((service) => service.build).map((service) => service.image).join(", ");
      return `Pushed Compose service images ${images}`;
    }
    return `Pushed image ${this.fullImageName(context)}`;
  }

  async runSecurityScan(context) {
    if (!this.config.securityScanEnabled) {
      return "Security scan disabled by configuration";
    }

    const images = context.plan?.type === "compose"
      ? context.plan.services.filter((service) => service.build).map((service) => service.image)
      : [this.fullImageName(context)];

    const outputs = [];
    for (const image of images) {
      const args = [
        "run",
        "--rm",
        "-v",
        "/var/run/docker.sock:/var/run/docker.sock",
        "aquasec/trivy:0.56.2",
        "image",
        "--severity",
        "HIGH,CRITICAL",
        "--exit-code",
        this.config.securityScanFailOnFindings ? "1" : "0",
        image
      ];
      outputs.push(await runCommand("docker", args));
    }
    return outputs.join("\n\n");
  }

  scanSuccessMessage(context) {
    if (!this.config.securityScanEnabled) return "Security scan skipped by configuration";
    if (context.plan?.type === "compose") {
      return "Scanned Compose service images for HIGH/CRITICAL vulnerabilities";
    }
    return `Scanned ${this.fullImageName(context)} for HIGH/CRITICAL vulnerabilities`;
  }

  releaseName(deployment) {
    const slug = `${this.config.helmReleasePrefix}-${deployment.repository}-${deployment.environment}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 45);
    return slug || `${this.config.helmReleasePrefix}-${deployment.id}`;
  }

  targetNamespace(context) {
    if (context.plan?.type !== "compose") return this.config.kubeNamespace;
    const suffix = context.releaseName
      .replace(new RegExp(`^${this.config.helmReleasePrefix}-`), "")
      .slice(0, 46)
      .replace(/^-|-$/g, "");
    return sanitizeKubernetesName(`${this.config.kubeNamespace}-${suffix}`);
  }

  rollbackNamespace(deployment) {
    if (deployment.namespace) return deployment.namespace;
    if (deployment.repository.toLowerCase().includes("multiservice-docker-platform")) {
      const suffix = this.releaseName(deployment)
        .replace(new RegExp(`^${this.config.helmReleasePrefix}-`), "")
        .slice(0, 46)
        .replace(/^-|-$/g, "");
      return sanitizeKubernetesName(`${this.config.kubeNamespace}-${suffix}`);
    }
    return this.config.kubeNamespace;
  }

  kubeEnv() {
    return {
      ...(this.config.kubeconfig ? { KUBECONFIG: this.config.kubeconfig } : {}),
      ...(this.config.kubeContext ? { HELM_KUBECONTEXT: this.config.kubeContext } : {})
    };
  }
}

function normalizeComposeBuild(build) {
  if (!build) return null;
  if (typeof build === "string") return { context: build, dockerfile: "Dockerfile" };
  return {
    context: build.context || ".",
    dockerfile: build.dockerfile || "Dockerfile"
  };
}

function normalizeEnvironment(environment) {
  if (!environment) return {};
  if (Array.isArray(environment)) {
    return Object.fromEntries(environment.map((item) => {
      const [key, ...value] = String(item).split("=");
      return [key, value.join("=")];
    }));
  }
  return Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, String(value)]));
}

function firstContainerPort(service) {
  const entries = [...(service.ports || []), ...(service.expose || [])];
  for (const entry of entries) {
    if (typeof entry === "number") return entry;
    const text = String(entry);
    const container = text.includes(":") ? text.split(":").pop() : text;
    const match = container.match(/^(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function defaultPortForService(name, image = "") {
  const text = `${name} ${image}`.toLowerCase();
  if (text.includes("postgres")) return 5432;
  if (text.includes("redis")) return 6379;
  if (text.includes("grafana")) return 3000;
  if (text.includes("prometheus")) return 9090;
  return 80;
}

function supportedComposeImage(image = "") {
  const text = String(image).toLowerCase();
  return text.startsWith("postgres:") || text.startsWith("redis:");
}

function splitImage(image) {
  const [repository, tag = "latest"] = image.split(":");
  return { repository, tag };
}

function readinessPathForService(name) {
  if (name === "web") return "/";
  if (name === "api") return "/ready";
  return "";
}

function sanitizeKubernetesName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function truncateLogs(logs) {
  const text = String(logs || "");
  if (text.length <= MAX_EVENT_LOG_CHARS) return text;
  return `${text.slice(0, MAX_EVENT_LOG_CHARS)}\n\n[logs truncated at ${MAX_EVENT_LOG_CHARS} characters]`;
}

function findPackageDirs(root) {
  const results = [];
  const visit = (dir, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if ([".git", "node_modules", "dist", "build", "coverage"].includes(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, "package.json"))) {
        results.push(child);
        continue;
      }
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return results;
}

function staticDockerfile() {
  return `FROM nginx:1.27-alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;
}

function nodeDockerfile() {
  return `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
`;
}

module.exports = { PipelineRunner, runCommand };
