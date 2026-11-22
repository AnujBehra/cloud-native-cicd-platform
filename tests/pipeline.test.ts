import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from '../src/db/database.js';
import { PipelineRunner } from '../src/engine/pipeline-runner.js';
import { LogStreamer } from '../src/engine/log-streamer.js';

describe('Pipeline Engine & Execution Lifecycle Tests', () => {
  const db = Database.getInstance();
  const runner = PipelineRunner.getInstance();
  const streamer = LogStreamer.getInstance();

  beforeAll(async () => {
    await db.initialize();
  });

  it('should create and execute a full 6-stage pipeline', async () => {
    const run = await runner.createPipelineRun({
      projectId: 'proj-order-service',
      triggerType: 'github_push',
      branch: 'main',
      commitSha: '9f8e7d6c',
      commitMessage: 'feat(order): add idempotency key support',
      author: 'sarah-dev',
      targetEnvironment: 'production',
    });

    expect(run.id).toBeDefined();
    expect(run.stages.length).toBe(6);
    expect(run.status).toBe('queued');

    // Execute pipeline
    const completedRun = await runner.executePipeline(run);
    expect(completedRun.status).toBe('passed');
    expect(completedRun.durationMs).toBeGreaterThan(0);
    expect(completedRun.stages.every(s => s.status === 'passed')).toBe(true);

    // Verify logs were streamed
    const logs = streamer.getLogs(completedRun.id);
    expect(logs.length).toBeGreaterThan(10);
    expect(logs.some(l => l.stageName === 'docker_build')).toBe(true);
    expect(logs.some(l => l.stageName === 'k8s_deploy')).toBe(true);
  }, 20000);
});
