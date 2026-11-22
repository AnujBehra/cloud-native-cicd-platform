import { Router, Request, Response } from 'express';
import { Database } from '../../db/database.js';
import { HelmManager } from '../../helm/helm-manager.js';

export const helmRouter = Router();
const db = Database.getInstance();
const helm = HelmManager.getInstance();

// GET /api/helm/releases/:name
helmRouter.get('/releases/:name', async (req: Request, res: Response) => {
  try {
    const namespace = (req.query.namespace as string) || 'production';
    const releases = await db.getHelmReleases(req.params.name, namespace);
    res.json({ success: true, count: releases.length, data: releases });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/helm/rollback
helmRouter.post('/rollback', async (req: Request, res: Response) => {
  try {
    const { releaseName, revision, namespace, actor } = req.body;
    if (!releaseName || !revision) {
      return res.status(400).json({ success: false, error: 'releaseName and revision are required' });
    }

    const result = await helm.rollback(
      releaseName,
      parseInt(revision, 10),
      namespace || 'production',
      actor || 'web-console-operator'
    );

    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
