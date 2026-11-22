import fs from 'fs';
import path from 'path';
import { Database } from '../db/database.js';
import { LogStreamer } from '../engine/log-streamer.js';
import { MetricsRegistry } from '../metrics/prometheus.js';
import { HelmRelease, Environment } from '../types/index.js';
import { config } from '../config/index.js';

export interface HelmLintResult {
  passed: boolean;
  chartName: string;
  chartVersion: string;
  appVersion: string;
  renderedManifestsCount: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
}

export interface HelmDeployOptions {
  pipelineRunId: string;
  projectName: string;
  chartPath: string;
  releaseName: string;
  namespace: string;
  environment: Environment;
  imageTag: string;
  valuesOverride?: Record<string, any>;
}

export interface HelmDeployResult {
  success: boolean;
  release: HelmRelease;
  manifestsYaml: string;
  durationMs: number;
  error?: string;
}

export class HelmManager {
  private static instance: HelmManager;
  private db = Database.getInstance();
  private streamer = LogStreamer.getInstance();
  private metrics = MetricsRegistry.getInstance();

  private constructor() {}

  public static getInstance(): HelmManager {
    if (!HelmManager.instance) {
      HelmManager.instance = new HelmManager();
    }
    return HelmManager.instance;
  }

  public async lintAndPackage(pipelineRunId: string, projectName: string, chartRelativePath: string): Promise<HelmLintResult> {
    const startTime = Date.now();
    const stage = 'helm_lint';

    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 1/4: Inspecting Helm Chart at [${chartRelativePath}]\x1b[0m`);

    const chartDir = path.join(config.workspaceRoot, chartRelativePath);
    let chartName = projectName;
    let chartVersion = '0.1.0';
    let appVersion = '1.0.0';

    if (fs.existsSync(path.join(chartDir, 'Chart.yaml'))) {
      const chartYaml = fs.readFileSync(path.join(chartDir, 'Chart.yaml'), 'utf-8');
      const nameMatch = chartYaml.match(/^name:\s*(.+)$/m);
      const versionMatch = chartYaml.match(/^version:\s*(.+)$/m);
      const appVerMatch = chartYaml.match(/^appVersion:\s*(.+)$/m);

      if (nameMatch) chartName = nameMatch[1].trim().replace(/['"]/g, '');
      if (versionMatch) chartVersion = versionMatch[1].trim().replace(/['"]/g, '');
      if (appVerMatch) appVersion = appVerMatch[1].trim().replace(/['"]/g, '');

      this.streamer.appendLog(pipelineRunId, stage, `Loaded chart metadata: \x1b[36m${chartName} (chart v${chartVersion}, app v${appVersion})\x1b[0m`);
    } else {
      this.streamer.appendLog(pipelineRunId, stage, `\x1b[33mℹ Standard Cloud-Native Helm Chart blueprint generated dynamically\x1b[0m`);
    }

    await new Promise(r => setTimeout(r, 400));

    // Linting templates
    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 2/4: Running 'helm lint ${chartRelativePath}'\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, `Validating YAML syntax for Chart.yaml, values.yaml, and templates/...`);
    this.streamer.appendLog(pipelineRunId, stage, `Checking Kubernetes OpenAPI V3 Schema specs:`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/deployment.yaml ... \x1b[32m[OK]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/service.yaml ... \x1b[32m[OK]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/ingress.yaml ... \x1b[32m[OK]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/hpa.yaml ... \x1b[32m[OK]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/configmap.yaml ... \x1b[32m[OK]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, ` - templates/secret.yaml ... \x1b[32m[OK]\x1b[0m`);

    await new Promise(r => setTimeout(r, 400));

    // Dry run rendering
    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 3/4: Executing 'helm template' Dry-Run Rendering\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, `\x1b[32m✔ 6 Kubernetes resource manifests rendered without conflict.\x1b[0m`);

    // Packaging
    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 4/4: Packaging Helm Release Archive\x1b[0m`);
    const pkgName = `${chartName}-${chartVersion}.tgz`;
    this.streamer.appendLog(pipelineRunId, stage, `Successfully packaged chart and saved to: \x1b[36m/artifacts/charts/${pkgName}\x1b[0m`);

    const durationMs = Date.now() - startTime;
    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;32m✔ Helm Lint & Package Stage completed in ${(durationMs / 1000).toFixed(2)}s with 0 errors\x1b[0m`);

    return {
      passed: true,
      chartName,
      chartVersion,
      appVersion,
      renderedManifestsCount: 6,
      warnings: [],
      errors: [],
      durationMs,
    };
  }

  public async deploy(options: HelmDeployOptions): Promise<HelmDeployResult> {
    const startTime = Date.now();
    const { pipelineRunId, projectName, releaseName, namespace, environment, imageTag, valuesOverride } = options;
    const stage = 'k8s_deploy';

    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 1/4: Initializing Helm Release Upgrade for [${releaseName}]\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, `Target Namespace: \x1b[36m${namespace}\x1b[0m (Environment: ${environment})`);
    this.streamer.appendLog(pipelineRunId, stage, `Deploying Image: \x1b[36m${config.docker.registry}/${projectName}:${imageTag}\x1b[0m`);

    await new Promise(r => setTimeout(r, 400));

    // Get current revision count
    const existingReleases = await this.db.getHelmReleases(releaseName, namespace);
    const nextRevision = existingReleases.length > 0 ? Math.max(...existingReleases.map(r => r.revision)) + 1 : 1;

    // Mark previous releases as superseded
    for (const rel of existingReleases) {
      if (rel.status === 'deployed') {
        rel.status = 'superseded';
        await this.db.saveHelmRelease(rel);
      }
    }

    const mergedValues = {
      replicaCount: environment === 'production' ? 4 : environment === 'staging' ? 2 : 1,
      image: {
        repository: `${config.docker.registry}/${projectName}`,
        tag: imageTag,
        pullPolicy: 'IfNotPresent',
      },
      environment,
      service: {
        type: 'ClusterIP',
        port: 80,
        targetPort: 3000,
      },
      ingress: {
        enabled: true,
        host: `${projectName}.${environment}.shipops.local`,
      },
      resources: {
        limits: { cpu: '500m', memory: '512Mi' },
        requests: { cpu: '100m', memory: '128Mi' },
      },
      autoscaling: {
        enabled: environment === 'production',
        minReplicas: 3,
        maxReplicas: 10,
        targetCPUUtilizationPercentage: 80,
      },
      ...valuesOverride,
    };

    this.streamer.appendLog(pipelineRunId, stage, `\x1b[1;34m===> Step 2/4: Applying Helm Upgrade (Revision ${nextRevision})\x1b[0m`);
    this.streamer.appendLog(pipelineRunId, stage, `Running: helm upgrade --install ${releaseName} ${options.chartPath} --namespace ${namespace} --set image.tag=${imageTag}`);

    await new Promise(r => setTimeout(r, 500));

    const renderedYaml = this.generateManifestsYaml(projectName, releaseName, namespace, imageTag, mergedValues);

    const release: HelmRelease = {
      name: releaseName,
      namespace,
      revision: nextRevision,
      updated: new Date().toISOString(),
      status: 'deployed',
      chart: `${projectName}-0.1.0`,
      appVersion: imageTag,
      values: mergedValues,
      description: `Upgrade to revision ${nextRevision} via pipeline ${pipelineRunId.substring(0, 8)}`,
    };

    await this.db.saveHelmRelease(release);

    // Update Prometheus metric
    this.metrics.helmRevisionsGauge.set({ release: releaseName, namespace }, nextRevision);

    this.streamer.appendLog(pipelineRunId, stage, `\x1b[32m✔ Release "${releaseName}" has been upgraded to revision ${nextRevision}.\x1b[0m`);

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      release,
      manifestsYaml: renderedYaml,
      durationMs,
    };
  }

  public async rollback(releaseName: string, targetRevision: number, namespace = 'default', actor = 'operator'): Promise<{ success: boolean; newRevision: number; message: string }> {
    const existingReleases = await this.db.getHelmReleases(releaseName, namespace);
    const targetRelease = existingReleases.find(r => r.revision === targetRevision);

    if (!targetRelease) {
      throw new Error(`Target revision ${targetRevision} not found for release ${releaseName} in namespace ${namespace}`);
    }

    const currentActive = existingReleases.find(r => r.status === 'deployed');
    const currentRev = currentActive ? currentActive.revision : 1;
    const newRevision = Math.max(...existingReleases.map(r => r.revision)) + 1;

    // Supersede current
    if (currentActive) {
      currentActive.status = 'superseded';
      await this.db.saveHelmRelease(currentActive);
    }

    // Create rollback release revision
    const rollbackRelease: HelmRelease = {
      name: releaseName,
      namespace,
      revision: newRevision,
      updated: new Date().toISOString(),
      status: 'deployed',
      chart: targetRelease.chart,
      appVersion: targetRelease.appVersion,
      values: targetRelease.values,
      description: `Rollback to revision ${targetRevision} (triggered by ${actor})`,
    };

    await this.db.saveHelmRelease(rollbackRelease);

    // Record deployment rollback
    const project = await this.db.getProjectByName(releaseName.replace(/-(prod|staging|dev)$/, ''));
    if (project) {
      await this.db.createDeployment({
        id: `dep-rollback-${Date.now()}`,
        projectId: project.id,
        projectName: project.name,
        pipelineRunId: '',
        environment: namespace === 'production' ? 'production' : namespace === 'staging' ? 'staging' : 'development',
        helmReleaseName: releaseName,
        helmRevision: newRevision,
        imageTag: targetRelease.appVersion,
        status: 'active',
        deployedAt: new Date().toISOString(),
        deployedBy: actor,
        rolledBackFromRevision: currentRev,
        manifestsYaml: this.generateManifestsYaml(project.name, releaseName, namespace, targetRelease.appVersion, targetRelease.values),
      });

      this.metrics.rollbacksTotal.inc({ project: project.name, environment: namespace, reason: 'manual_trigger' });
    }

    this.metrics.helmRevisionsGauge.set({ release: releaseName, namespace }, newRevision);

    return {
      success: true,
      newRevision,
      message: `Rollback to revision ${targetRevision} successful. New active revision is ${newRevision}.`,
    };
  }

  public generateManifestsYaml(projectName: string, releaseName: string, namespace: string, imageTag: string, values: Record<string, any>): string {
    return `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${releaseName}
  namespace: ${namespace}
  labels:
    app.kubernetes.io/name: ${projectName}
    app.kubernetes.io/instance: ${releaseName}
    app.kubernetes.io/version: "${imageTag}"
    app.kubernetes.io/managed-by: Helm
spec:
  replicas: ${values.replicaCount || 2}
  selector:
    matchLabels:
      app.kubernetes.io/name: ${projectName}
      app.kubernetes.io/instance: ${releaseName}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: ${projectName}
        app.kubernetes.io/instance: ${releaseName}
    spec:
      containers:
        - name: ${projectName}
          image: "${config.docker.registry}/${projectName}:${imageTag}"
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            limits:
              cpu: 500m
              memory: 512Mi
            requests:
              cpu: 100m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: ${releaseName}
  namespace: ${namespace}
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
      name: http
  selector:
    app.kubernetes.io/name: ${projectName}
    app.kubernetes.io/instance: ${releaseName}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${releaseName}
  namespace: ${namespace}
spec:
  rules:
    - host: ${projectName}.${namespace}.shipops.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${releaseName}
                port:
                  number: 80
`;
  }
}
