import express from 'express';
import cors from 'cors';
import { Database } from '../src/db/database';
import { projectsRouter } from '../src/api/routes/projects';
import { pipelinesRouter } from '../src/api/routes/pipelines';
import { deploymentsRouter } from '../src/api/routes/deployments';
import { helmRouter } from '../src/api/routes/helm';
import { k8sRouter } from '../src/api/routes/k8s';
import { webhooksRouter } from '../src/api/routes/webhooks';
import { metricsRouter } from '../src/api/routes/metrics';
import { simulatorRouter } from '../src/api/routes/simulator';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/healthz', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    postgresConnected: Database.getInstance().isPostgresConnected,
    environment: 'vercel-serverless',
  });
});

app.use('/api/projects', projectsRouter);
app.use('/api/pipelines', pipelinesRouter);
app.use('/api/deployments', deploymentsRouter);
app.use('/api/helm', helmRouter);
app.use('/api/k8s', k8sRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/metrics', metricsRouter);
app.use('/metrics', metricsRouter);
app.use('/api/simulator', simulatorRouter);

export default app;
