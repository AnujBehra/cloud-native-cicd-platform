import { Pool, QueryResult } from 'pg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { Project, PipelineRun, StageExecution, Deployment, HelmRelease, Environment } from '../types/index.js';

export class Database {
  private static instance: Database;
  private pool: Pool | null = null;
  public isPostgresConnected = false;

  // In-memory persistent cache / fallback store
  private projects: Map<string, Project> = new Map();
  private pipelineRuns: Map<string, PipelineRun> = new Map();
  private stageExecutions: Map<string, StageExecution> = new Map();
  private deployments: Map<string, Deployment> = new Map();
  private helmReleases: Map<string, HelmRelease[]> = new Map(); // key: name:namespace

  private constructor() {}

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async initialize(): Promise<void> {
    try {
      this.pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      const client = await this.pool.connect();
      this.isPostgresConnected = true;
      console.log('✅ Connected to PostgreSQL database at', `${config.db.host}:${config.db.port}/${config.db.database}`);

      // Run schema migrations
      const schemaSqlPath = path.join(config.workspaceRoot, 'src', 'db', 'schema.sql');
      if (fs.existsSync(schemaSqlPath)) {
        const schemaSql = fs.readFileSync(schemaSqlPath, 'utf-8');
        await client.query(schemaSql);
        console.log('✅ PostgreSQL schema migrations applied successfully.');
      }
      client.release();
    } catch (err: any) {
      console.warn(`⚠️ PostgreSQL connection not established (${err.message}). Using high-performance embedded state store.`);
      this.isPostgresConnected = false;
    }

    // Seed default sample data if empty
    await this.seedInitialData();
  }

  private async seedInitialData(): Promise<void> {
    const existingProjects = await this.getProjects();
    if (existingProjects.length > 0) return;

    console.log('🌱 Seeding initial Cloud-Native projects and Helm releases...');

    // Seed project 1: Order Service
    const orderProject: Project = {
      id: 'proj-order-service',
      name: 'order-service',
      repoUrl: 'https://github.com/shipops-demo/order-service.git',
      defaultBranch: 'main',
      helmChartPath: 'charts/order-service',
      dockerfilePath: 'sample-apps/order-service/Dockerfile',
      environments: ['development', 'staging', 'production'],
      webhookSecret: config.webhook.secret,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Seed project 2: Payment API
    const paymentProject: Project = {
      id: 'proj-payment-gateway',
      name: 'payment-gateway',
      repoUrl: 'https://github.com/shipops-demo/payment-gateway.git',
      defaultBranch: 'main',
      helmChartPath: 'charts/payment-gateway',
      dockerfilePath: 'sample-apps/payment-gateway/Dockerfile',
      environments: ['development', 'staging', 'production'],
      webhookSecret: config.webhook.secret,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.createProject(orderProject);
    await this.createProject(paymentProject);

    // Seed historic deployments and Helm releases for order-service
    const helmRel1: HelmRelease = {
      name: 'order-service-prod',
      namespace: 'production',
      revision: 1,
      updated: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      status: 'superseded',
      chart: 'order-service-0.9.0',
      appVersion: 'v0.9.0',
      values: { replicaCount: 3, image: { repository: 'registry.shipops.internal/order-service', tag: 'v0.9.0' }, env: 'production' },
      description: 'Initial production rollout',
    };

    const helmRel2: HelmRelease = {
      name: 'order-service-prod',
      namespace: 'production',
      revision: 2,
      updated: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      status: 'deployed',
      chart: 'order-service-1.0.0',
      appVersion: 'v1.0.0',
      values: { replicaCount: 4, image: { repository: 'registry.shipops.internal/order-service', tag: 'v1.0.0' }, env: 'production' },
      description: 'Release v1.0.0 with distributed tracing',
    };

    await this.saveHelmRelease(helmRel1);
    await this.saveHelmRelease(helmRel2);

    // Seed initial pipeline run
    const initialRun: PipelineRun = {
      id: 'pipe-initial-prod',
      projectId: orderProject.id,
      projectName: orderProject.name,
      triggerType: 'github_push',
      branch: 'main',
      commitSha: '7f8a9b0c',
      commitMessage: 'Release v1.0.0 with distributed tracing',
      author: 'shipops-bot',
      status: 'passed',
      targetEnvironment: 'production',
      imageTag: 'v1.0.0',
      helmReleaseName: 'order-service-prod',
      helmRevision: 2,
      stages: [],
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      finishedAt: new Date(Date.now() - 1000 * 60 * 60 * 12 + 18000).toISOString(),
      durationMs: 18000,
    };
    await this.createPipelineRun(initialRun);

    const dep1: Deployment = {
      id: 'dep-order-v1',
      projectId: orderProject.id,
      projectName: orderProject.name,
      pipelineRunId: 'pipe-initial-prod',
      environment: 'production',
      helmReleaseName: 'order-service-prod',
      helmRevision: 2,
      imageTag: 'v1.0.0',
      status: 'active',
      deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
      deployedBy: 'shipops-bot',
    };
    await this.createDeployment(dep1);
  }

  // Projects CRUD
  public async getProjects(): Promise<Project[]> {
    if (this.isPostgresConnected && this.pool) {
      const res = await this.pool.query('SELECT * FROM projects ORDER BY created_at DESC');
      return res.rows.map(r => ({
        id: r.id,
        name: r.name,
        repoUrl: r.repo_url,
        defaultBranch: r.default_branch,
        helmChartPath: r.helm_chart_path,
        dockerfilePath: r.dockerfile_path,
        environments: typeof r.environments === 'string' ? JSON.parse(r.environments) : r.environments,
        webhookSecret: r.webhook_secret,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));
    }
    return Array.from(this.projects.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async getProjectById(id: string): Promise<Project | null> {
    if (this.isPostgresConnected && this.pool) {
      const res = await this.pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        name: r.name,
        repoUrl: r.repo_url,
        defaultBranch: r.default_branch,
        helmChartPath: r.helm_chart_path,
        dockerfilePath: r.dockerfile_path,
        environments: typeof r.environments === 'string' ? JSON.parse(r.environments) : r.environments,
        webhookSecret: r.webhook_secret,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
    }
    return this.projects.get(id) || null;
  }

  public async getProjectByName(name: string): Promise<Project | null> {
    if (this.isPostgresConnected && this.pool) {
      const res = await this.pool.query('SELECT * FROM projects WHERE name = $1', [name]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        name: r.name,
        repoUrl: r.repo_url,
        defaultBranch: r.default_branch,
        helmChartPath: r.helm_chart_path,
        dockerfilePath: r.dockerfile_path,
        environments: typeof r.environments === 'string' ? JSON.parse(r.environments) : r.environments,
        webhookSecret: r.webhook_secret,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
    }
    for (const p of this.projects.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return p;
    }
    return null;
  }

  public async createProject(project: Project): Promise<Project> {
    if (this.isPostgresConnected && this.pool) {
      await this.pool.query(
        `INSERT INTO projects (id, name, repo_url, default_branch, helm_chart_path, dockerfile_path, environments, webhook_secret, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
        [
          project.id,
          project.name,
          project.repoUrl,
          project.defaultBranch,
          project.helmChartPath,
          project.dockerfilePath,
          JSON.stringify(project.environments),
          project.webhookSecret,
          project.createdAt,
          project.updatedAt,
        ]
      );
    }
    this.projects.set(project.id, project);
    return project;
  }

  // Pipeline Runs & Stages
  public async createPipelineRun(run: PipelineRun): Promise<PipelineRun> {
    if (this.isPostgresConnected && this.pool) {
      await this.pool.query(
        `INSERT INTO pipeline_runs (id, project_id, project_name, trigger_type, branch, commit_sha, commit_message, author, status, target_environment, image_tag, helm_release_name, helm_revision, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          run.id,
          run.projectId,
          run.projectName || 'unknown',
          run.triggerType,
          run.branch,
          run.commitSha,
          run.commitMessage,
          run.author,
          run.status,
          run.targetEnvironment,
          run.imageTag || null,
          run.helmReleaseName || null,
          run.helmRevision || null,
          run.startedAt,
        ]
      );
      for (const stage of run.stages) {
        await this.pool.query(
          `INSERT INTO stage_executions (id, pipeline_run_id, stage_name, display_name, status, exit_code, logs, started_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [stage.id, stage.pipelineRunId, stage.stageName, stage.displayName, stage.status, stage.exitCode || 0, stage.logs || '', stage.startedAt || null]
        );
      }
    }
    this.pipelineRuns.set(run.id, run);
    for (const stage of run.stages) {
      this.stageExecutions.set(stage.id, stage);
    }
    return run;
  }

  public async updatePipelineRun(run: PipelineRun): Promise<void> {
    if (this.isPostgresConnected && this.pool) {
      await this.pool.query(
        `UPDATE pipeline_runs
         SET status = $1, finished_at = $2, duration_ms = $3, error = $4, image_tag = $5, helm_release_name = $6, helm_revision = $7
         WHERE id = $8`,
        [run.status, run.finishedAt || null, run.durationMs || null, run.error || null, run.imageTag || null, run.helmReleaseName || null, run.helmRevision || null, run.id]
      );
    }
    this.pipelineRuns.set(run.id, run);
  }

  public async updateStageExecution(stage: StageExecution): Promise<void> {
    if (this.isPostgresConnected && this.pool) {
      await this.pool.query(
        `UPDATE stage_executions
         SET status = $1, exit_code = $2, logs = $3, started_at = $4, finished_at = $5, duration_ms = $6
         WHERE id = $7`,
        [stage.status, stage.exitCode || 0, stage.logs, stage.startedAt || null, stage.finishedAt || null, stage.durationMs || null, stage.id]
      );
    }
    this.stageExecutions.set(stage.id, stage);
  }

  public async getPipelineRuns(projectId?: string, limit = 50): Promise<PipelineRun[]> {
    if (this.isPostgresConnected && this.pool) {
      const query = projectId
        ? 'SELECT * FROM pipeline_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT $2'
        : 'SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT $1';
      const params = projectId ? [projectId, limit] : [limit];
      const res = await this.pool.query(query, params);

      const runs: PipelineRun[] = [];
      for (const r of res.rows) {
        const stagesRes = await this.pool.query(
          'SELECT * FROM stage_executions WHERE pipeline_run_id = $1 ORDER BY started_at ASC',
          [r.id]
        );
        runs.push({
          id: r.id,
          projectId: r.project_id,
          projectName: r.project_name,
          triggerType: r.trigger_type,
          branch: r.branch,
          commitSha: r.commit_sha,
          commitMessage: r.commit_message,
          author: r.author,
          status: r.status,
          targetEnvironment: r.target_environment,
          imageTag: r.image_tag,
          helmReleaseName: r.helm_release_name,
          helmRevision: r.helm_revision,
          startedAt: r.started_at.toISOString(),
          finishedAt: r.finished_at ? r.finished_at.toISOString() : undefined,
          durationMs: r.duration_ms ? parseInt(r.duration_ms, 10) : undefined,
          error: r.error,
          stages: stagesRes.rows.map(s => ({
            id: s.id,
            pipelineRunId: s.pipeline_run_id,
            stageName: s.stage_name,
            displayName: s.display_name,
            status: s.status,
            exitCode: s.exit_code,
            logs: s.logs,
            startedAt: s.started_at ? s.started_at.toISOString() : undefined,
            finishedAt: s.finished_at ? s.finished_at.toISOString() : undefined,
            durationMs: s.duration_ms ? parseInt(s.duration_ms, 10) : undefined,
          })),
        });
      }
      return runs;
    }

    let runs = Array.from(this.pipelineRuns.values());
    if (projectId) {
      runs = runs.filter(r => r.projectId === projectId);
    }
    return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, limit);
  }

  public async getPipelineRunById(id: string): Promise<PipelineRun | null> {
    if (this.isPostgresConnected && this.pool) {
      const res = await this.pool.query('SELECT * FROM pipeline_runs WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      const stagesRes = await this.pool.query(
        'SELECT * FROM stage_executions WHERE pipeline_run_id = $1 ORDER BY started_at ASC',
        [r.id]
      );
      return {
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        triggerType: r.trigger_type,
        branch: r.branch,
        commitSha: r.commit_sha,
        commitMessage: r.commit_message,
        author: r.author,
        status: r.status,
        targetEnvironment: r.target_environment,
        imageTag: r.image_tag,
        helmReleaseName: r.helm_release_name,
        helmRevision: r.helm_revision,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at ? r.finished_at.toISOString() : undefined,
        durationMs: r.duration_ms ? parseInt(r.duration_ms, 10) : undefined,
        error: r.error,
        stages: stagesRes.rows.map(s => ({
          id: s.id,
          pipelineRunId: s.pipeline_run_id,
          stageName: s.stage_name,
          displayName: s.display_name,
          status: s.status,
          exitCode: s.exit_code,
          logs: s.logs,
          startedAt: s.started_at ? s.started_at.toISOString() : undefined,
          finishedAt: s.finished_at ? s.finished_at.toISOString() : undefined,
          durationMs: s.duration_ms ? parseInt(s.duration_ms, 10) : undefined,
        })),
      };
    }
    return this.pipelineRuns.get(id) || null;
  }

  // Deployments CRUD
  public async createDeployment(dep: Deployment): Promise<Deployment> {
    if (this.isPostgresConnected && this.pool) {
      // Mark previous active deployments in this environment as superseded
      await this.pool.query(
        `UPDATE deployments SET status = 'superseded' WHERE project_id = $1 AND environment = $2 AND status = 'active'`,
        [dep.projectId, dep.environment]
      );

      await this.pool.query(
        `INSERT INTO deployments (id, project_id, project_name, pipeline_run_id, environment, helm_release_name, helm_revision, image_tag, status, deployed_at, deployed_by, rolled_back_from_revision, manifests_yaml)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          dep.id,
          dep.projectId,
          dep.projectName,
          dep.pipelineRunId || null,
          dep.environment,
          dep.helmReleaseName,
          dep.helmRevision,
          dep.imageTag,
          dep.status,
          dep.deployedAt,
          dep.deployedBy,
          dep.rolledBackFromRevision || null,
          dep.manifestsYaml || null,
        ]
      );
    }

    // Update in-memory
    for (const d of this.deployments.values()) {
      if (d.projectId === dep.projectId && d.environment === dep.environment && d.status === 'active') {
        d.status = 'superseded';
      }
    }
    this.deployments.set(dep.id, dep);
    return dep;
  }

  public async getDeployments(environment?: Environment): Promise<Deployment[]> {
    if (this.isPostgresConnected && this.pool) {
      const query = environment
        ? 'SELECT * FROM deployments WHERE environment = $1 ORDER BY deployed_at DESC LIMIT 50'
        : 'SELECT * FROM deployments ORDER BY deployed_at DESC LIMIT 50';
      const params = environment ? [environment] : [];
      const res = await this.pool.query(query, params);
      return res.rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        pipelineRunId: r.pipeline_run_id,
        environment: r.environment,
        helmReleaseName: r.helm_release_name,
        helmRevision: r.helm_revision,
        imageTag: r.image_tag,
        status: r.status,
        deployedAt: r.deployed_at.toISOString(),
        deployedBy: r.deployed_by,
        rolledBackFromRevision: r.rolled_back_from_revision,
        manifestsYaml: r.manifests_yaml,
      }));
    }

    let deps = Array.from(this.deployments.values());
    if (environment) {
      deps = deps.filter(d => d.environment === environment);
    }
    return deps.sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime());
  }

  // Helm Releases
  public async saveHelmRelease(rel: HelmRelease): Promise<void> {
    const key = `${rel.name}:${rel.namespace}`;
    if (this.isPostgresConnected && this.pool) {
      await this.pool.query(
        `INSERT INTO helm_releases (name, namespace, revision, updated, status, chart, app_version, values, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (name, namespace, revision) DO UPDATE 
         SET status = $5, updated = $4, description = $9`,
        [rel.name, rel.namespace, rel.revision, rel.updated, rel.status, rel.chart, rel.appVersion, JSON.stringify(rel.values), rel.description || '']
      );
    }

    const list = this.helmReleases.get(key) || [];
    const idx = list.findIndex(r => r.revision === rel.revision);
    if (idx >= 0) {
      list[idx] = rel;
    } else {
      list.push(rel);
    }
    this.helmReleases.set(key, list);
  }

  public async getHelmReleases(name: string, namespace = 'default'): Promise<HelmRelease[]> {
    const key = `${name}:${namespace}`;
    if (this.isPostgresConnected && this.pool) {
      const res = await this.pool.query(
        'SELECT * FROM helm_releases WHERE name = $1 AND namespace = $2 ORDER BY revision DESC',
        [name, namespace]
      );
      return res.rows.map(r => ({
        name: r.name,
        namespace: r.namespace,
        revision: r.revision,
        updated: r.updated.toISOString(),
        status: r.status,
        chart: r.chart,
        appVersion: r.app_version,
        values: typeof r.values === 'string' ? JSON.parse(r.values) : r.values,
        description: r.description,
      }));
    }
    const list = this.helmReleases.get(key) || [];
    return [...list].sort((a, b) => b.revision - a.revision);
  }
}
