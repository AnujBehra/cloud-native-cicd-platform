import { Router, Request, Response } from 'express';
import { MetricsRegistry } from '../../metrics/prometheus.js';
import { Database } from '../../db/database.js';

export const metricsRouter = Router();
const metrics = MetricsRegistry.getInstance();
const db = Database.getInstance();

// GET /metrics (Prometheus standard scrape endpoint)
metricsRouter.get('/', async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', metrics.registry.contentType);
    const result = await metrics.registry.metrics();
    res.send(result);
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// GET /api/metrics/dora (JSON DORA Metrics for UI Dashboard)
metricsRouter.get('/dora', async (req: Request, res: Response) => {
  try {
    const runs = await db.getPipelineRuns(undefined, 100);
    const deployments = await db.getDeployments();
    const dora = metrics.calculateDoraMetrics(runs, deployments);
    res.json({ success: true, data: dora });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
