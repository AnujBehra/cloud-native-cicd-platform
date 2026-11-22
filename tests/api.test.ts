import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { Database } from '../src/db/database.js';

describe('REST API & Metrics Endpoints Tests', () => {
  let app: any;

  beforeAll(async () => {
    await Database.getInstance().initialize();
    const serverObj = await createServer();
    app = serverObj.app;
  });

  it('GET /healthz should return 200 OK', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('GET /api/projects should return project list', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/pipelines/trigger should queue a new pipeline', async () => {
    const res = await request(app)
      .post('/api/pipelines/trigger')
      .send({
        projectId: 'proj-order-service',
        targetEnvironment: 'production',
        author: 'api-tester',
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
  });

  it('GET /api/metrics/dora should return calculated DORA metrics', async () => {
    const res = await request(app).get('/api/metrics/dora');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deploymentFrequency).toBeDefined();
    expect(res.body.data.changeFailureRate).toBeDefined();
  });

  it('GET /metrics should return Prometheus metrics text', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('cicd_pipeline_runs_total');
  });

  it('POST /api/webhooks/github should process GitHub webhook', async () => {
    const res = await request(app)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'push')
      .send({
        repository: {
          name: 'order-service',
          clone_url: 'https://github.com/shipops-demo/order-service.git',
          default_branch: 'main',
        },
        ref: 'refs/heads/main',
        head_commit: {
          id: 'c1d2e3f4',
          message: 'feat: add metrics telemetry',
          author: { name: 'dev-lead' },
        },
      });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.pipelineRunId).toBeDefined();
  });
});
