import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from '../src/db/database.js';
import { Project, PipelineRun, Deployment } from '../src/types/index.js';

describe('Database Layer & Schema Tests', () => {
  const db = Database.getInstance();

  beforeAll(async () => {
    await db.initialize();
  });

  it('should list seeded projects', async () => {
    const projects = await db.getProjects();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const orderProj = projects.find(p => p.name === 'order-service');
    expect(orderProj).toBeDefined();
    expect(orderProj?.environments).toContain('production');
  });

  it('should create and retrieve a new project', async () => {
    const newProj: Project = {
      id: 'proj-test-auth',
      name: 'auth-service',
      repoUrl: 'https://github.com/shipops-demo/auth-service.git',
      defaultBranch: 'main',
      helmChartPath: 'charts/auth-service',
      dockerfilePath: 'Dockerfile',
      environments: ['development', 'production'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.createProject(newProj);
    const fetched = await db.getProjectById('proj-test-auth');
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('auth-service');
  });

  it('should create and update pipeline runs and stages', async () => {
    const runId = 'test-run-101';
    const run: PipelineRun = {
      id: runId,
      projectId: 'proj-order-service',
      projectName: 'order-service',
      triggerType: 'manual',
      branch: 'main',
      commitSha: 'a1b2c3d4',
      commitMessage: 'fix: database connection pool timeout',
      author: 'devops-lead',
      status: 'queued',
      targetEnvironment: 'production',
      stages: [
        {
          id: 'stage-101',
          pipelineRunId: runId,
          stageName: 'checkout',
          displayName: '1. Source Checkout',
          status: 'pending',
          logs: '',
        },
      ],
      startedAt: new Date().toISOString(),
    };

    await db.createPipelineRun(run);
    let fetched = await db.getPipelineRunById(runId);
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe('queued');

    // Update status
    run.status = 'passed';
    run.durationMs = 12500;
    await db.updatePipelineRun(run);

    fetched = await db.getPipelineRunById(runId);
    expect(fetched?.status).toBe('passed');
    expect(fetched?.durationMs).toBe(12500);
  });

  it('should record deployments and track environment status', async () => {
    const dep: Deployment = {
      id: 'dep-test-101',
      projectId: 'proj-order-service',
      projectName: 'order-service',
      pipelineRunId: 'test-run-101',
      environment: 'staging',
      helmReleaseName: 'order-service-staging',
      helmRevision: 3,
      imageTag: 'v1.1.0',
      status: 'active',
      deployedAt: new Date().toISOString(),
      deployedBy: 'shipops-ci',
    };

    await db.createDeployment(dep);
    const deps = await db.getDeployments('staging');
    expect(deps.length).toBeGreaterThanOrEqual(1);
    expect(deps[0].helmRevision).toBe(3);
  });
});
