import { Router, Request, Response } from 'express';
import { Database } from '../../db/database.js';
import { JobQueue } from '../../engine/job-queue.js';
import { Environment } from '../../types/index.js';

export const simulatorRouter = Router();
const db = Database.getInstance();
const queue = JobQueue.getInstance();

// POST /api/simulator/push
simulatorRouter.post('/push', async (req: Request, res: Response) => {
  try {
    const { projectName = 'order-service', branch = 'main', commitMessage } = req.body;
    const project = await db.getProjectByName(projectName);
    if (!project) {
      return res.status(404).json({ success: false, error: `Project ${projectName} not found` });
    }

    const sha = Math.random().toString(36).substring(2, 9);
    const targetEnvironment: Environment = branch === 'main' ? 'production' : branch === 'staging' ? 'staging' : 'development';

    const run = await queue.enqueue({
      projectId: project.id,
      triggerType: 'github_push',
      branch,
      commitSha: sha,
      commitMessage: commitMessage || `feat(core): optimized checkout latency and database indexing (#${Math.floor(Math.random() * 80 + 10)})`,
      author: 'alex-engineer',
      targetEnvironment,
    });

    res.status(202).json({
      success: true,
      message: `Simulated GitHub push on ${branch} for ${projectName}. Pipeline ${run.id} started.`,
      pipelineRun: run,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/simulator/pr
simulatorRouter.post('/pr', async (req: Request, res: Response) => {
  try {
    const { projectName = 'order-service', branch = 'feat/payment-retry', prNumber = 42 } = req.body;
    const project = await db.getProjectByName(projectName);
    if (!project) {
      return res.status(404).json({ success: false, error: `Project ${projectName} not found` });
    }

    const sha = Math.random().toString(36).substring(2, 9);

    const run = await queue.enqueue({
      projectId: project.id,
      triggerType: 'github_pr',
      branch,
      commitSha: sha,
      commitMessage: `PR #${prNumber}: Implement exponential backoff for payment gateway retries`,
      author: 'dev-contributor',
      targetEnvironment: 'development',
    });

    res.status(202).json({
      success: true,
      message: `Simulated Pull Request #${prNumber} opened. Pipeline ${run.id} started.`,
      pipelineRun: run,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
