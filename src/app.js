const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const pinoHttp = require("pino-http");
const { randomUUID } = require("crypto");
const { z } = require("zod");
const { client } = require("./metrics");
const { PipelineRunner } = require("./pipeline");
const { PipelineQueue } = require("./queue");
const { logger } = require("./logger");
const { requireApiKey } = require("./middleware/auth");
const { verifyGitHubWebhook } = require("./middleware/githubWebhook");

const deploymentSchema = z.object({
  repository: z.string().min(1).transform(normalizeRepository),
  branch: z.string().min(1).default("main"),
  commit_sha: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().min(7).optional()
  ),
  environment: z.enum(["dev", "staging", "prod"]).default("dev")
});

function createApp({ store, config }) {
  const app = express();
  const runner = new PipelineRunner({ store, config, logger });
  const queue = new PipelineQueue({ runner, concurrency: config.pipelineConcurrency || 1, logger });

  app.disable("x-powered-by");
  app.use(pinoHttp({ logger }));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }));
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buffer) => {
        req.rawBody = buffer;
      }
    })
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );
  app.use(requireApiKey(config));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", async (_req, res, next) => {
    try {
      await store.healthCheck();
      res.json({ status: "ready" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", client.register.contentType);
    res.end(await client.register.metrics());
  });

  app.get("/api/deployments", async (_req, res, next) => {
    try {
      res.json(await store.listDeployments());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/queue", (_req, res) => {
    res.json(queue.stats());
  });

  app.get("/api/deployments/:id", async (req, res, next) => {
    try {
      const deployment = await store.getDeployment(req.params.id);
      if (!deployment) return res.status(404).json({ error: "Deployment not found" });
      const events = await store.listEvents(req.params.id);
      return res.json({ ...deployment, events });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/deployments", async (req, res, next) => {
    try {
      const input = deploymentSchema.parse(req.body);
      const deployment = await createDeployment(store, input, config);
      const result = await queuePipeline(queue, runner, deployment, config);
      res.status(config.runPipelinesInline ? 200 : 202).json(result || deployment);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/webhooks/github", verifyGitHubWebhook(config), async (req, res, next) => {
    try {
      const payload = req.body;
      const input = deploymentSchema.parse({
        repository: payload.repository?.full_name || payload.repository || "unknown/repository",
        branch: String(payload.ref || "refs/heads/main").replace("refs/heads/", ""),
        commit_sha: payload.after || payload.head_commit?.id || "0000000",
        environment: payload.environment || "dev"
      });
      const deployment = await createDeployment(store, input, config);
      const result = await queuePipeline(queue, runner, deployment, config);
      res.status(config.runPipelinesInline ? 200 : 202).json(result || deployment);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/deployments/:id/rollback", async (req, res, next) => {
    try {
      const deployment = await store.getDeployment(req.params.id);
      if (!deployment) return res.status(404).json({ error: "Deployment not found" });
      if (!["deployed", "failed", "rolled_back"].includes(deployment.status)) {
        return res.status(409).json({ error: "Deployment is not in a rollbackable state" });
      }
      const rolledBack = await runner.rollback(deployment);
      return res.json(rolledBack);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", issues: error.issues });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error({ error }, "request failed");
    return res.status(500).json({ error: error.message || "Internal server error" });
  });

  return app;
}

async function createDeployment(store, input, config = {}) {
  const commitSha = input.commit_sha || await resolveCommitSha(input.repository, input.branch, config);
  const shortSha = commitSha.slice(0, 12);
  const repositorySlug = input.repository.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return store.createDeployment({
    id: randomUUID().slice(0, 12),
    ...input,
    commit_sha: commitSha,
    image_tag: `${repositorySlug}:${shortSha}`
  });
}

function normalizeRepository(value) {
  const trimmed = value.trim();
  if (/^https:\/\/github\.com\//i.test(trimmed)) {
    return trimmed
      .replace(/^https:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "");
  }
  return trimmed.replace(/^\/+|\/+$/g, "");
}

async function resolveCommitSha(repository, branch, config = {}) {
  if (config.resolveCommitSha) return config.resolveCommitSha(repository, branch);

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw userInputError("Commit SHA is required when repository is not a GitHub owner/repo public repository.");
  }

  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "cloud-native-cicd-platform"
  };
  if (config.gitAuthToken) {
    headers.Authorization = `Bearer ${config.gitAuthToken}`;
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`, {
    headers
  });

  if (!response.ok) {
    throw userInputError(`Unable to resolve latest commit for ${repository}@${branch}. Provide a valid public GitHub repo, branch, or commit SHA.`);
  }

  const payload = await response.json();
  if (!payload.sha) {
    throw userInputError(`GitHub did not return a commit SHA for ${repository}@${branch}.`);
  }
  return payload.sha;
}

function userInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function queuePipeline(queue, runner, deployment, config = {}) {
  if (config.runPipelinesInline) {
    return runner.run(deployment);
  }
  queue.enqueue(deployment);
  return null;
}

module.exports = { createApp, createDeployment, normalizeRepository, resolveCommitSha };
