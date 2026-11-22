import { Router, Request, Response } from 'express';
import { Database } from '../../db/database.js';
import { HelmManager } from '../../helm/helm-manager.js';
import { Environment } from '../../types/index.js';

export const deploymentsRouter = Router();
const db = Database.getInstance();
const helm = HelmManager.getInstance();

// GET /api/deployments
deploymentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const env = req.query.environment as Environment | undefined;
    const deployments = await db.getDeployments(env);
    res.json({ success: true, count: deployments.length, data: deployments });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/deployments/rollback
deploymentsRouter.post('/rollback', async (req: Request, res: Response) => {
  try {
    const { releaseName, targetRevision, namespace, actor } = req.body;
    if (!releaseName || !targetRevision) {
      return res.status(400).json({ success: false, error: 'releaseName and targetRevision are required' });
    }

    const result = await helm.rollback(
      releaseName,
      parseInt(targetRevision, 10),
      namespace || 'production',
      actor || 'web-console-user'
    );

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
