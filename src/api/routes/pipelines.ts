import { Router, Request, Response } from 'express';
import { Database } from '../../db/database.js';
import { JobQueue } from '../../engine/job-queue.js';
import { LogStreamer } from '../../engine/log-streamer.js';

export const pipelinesRouter = Router();
const db = Database.getInstance();
const queue = JobQueue.getInstance();
const streamer = LogStreamer.getInstance();

// GET /api/pipelines
pipelinesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const runs = await db.getPipelineRuns(projectId, limit);
    res.json({ success: true, count: runs.length, data: runs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/pipelines/trigger
pipelinesRouter.post('/trigger', async (req: Request, res: Response) => {
  try {
    const { projectId, branch, commitSha, commitMessage, author, targetEnvironment, customImageTag } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'projectId is required' });
    }

    const run = await queue.enqueue({
      projectId,
      triggerType: 'manual',
      branch,
      commitSha,
      commitMessage,
      author: author || 'operator',
      targetEnvironment,
      customImageTag,
    });

    res.status(202).json({
      success: true,
      message: 'Pipeline run queued successfully',
      data: run,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/pipelines/:id
pipelinesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const run = await db.getPipelineRunById(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Pipeline run not found' });
    }
    res.json({ success: true, data: run });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/pipelines/:id/logs
pipelinesRouter.get('/:id/logs', (req: Request, res: Response) => {
  const logs = streamer.getLogs(req.params.id);
  res.json({ success: true, count: logs.length, data: logs });
});

// GET /api/pipelines/:id/stream (Server-Sent Events)
pipelinesRouter.get('/:id/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  streamer.registerSSE(req.params.id, res);
});
