import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config/index.js';
import { Database } from './db/database.js';
import { LogStreamer } from './engine/log-streamer.js';

// Import Routes
import { projectsRouter } from './api/routes/projects.js';
import { pipelinesRouter } from './api/routes/pipelines.js';
import { deploymentsRouter } from './api/routes/deployments.js';
import { helmRouter } from './api/routes/helm.js';
import { k8sRouter } from './api/routes/k8s.js';
import { webhooksRouter } from './api/routes/webhooks.js';
import { metricsRouter } from './api/routes/metrics.js';
import { simulatorRouter } from './api/routes/simulator.js';

export async function createServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/logs' });
  const streamer = LogStreamer.getInstance();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Static Assets (Web Dashboard Console)
  const publicPath = path.join(config.workspaceRoot, 'public');
  app.use(express.static(publicPath));

  // Health check
  app.get('/healthz', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      postgresConnected: Database.getInstance().isPostgresConnected,
    });
  });

  // API Routes
  app.use('/api/projects', projectsRouter);
  app.use('/api/pipelines', pipelinesRouter);
  app.use('/api/deployments', deploymentsRouter);
  app.use('/api/helm', helmRouter);
  app.use('/api/k8s', k8sRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/metrics', metricsRouter);
  app.use('/api/simulator', simulatorRouter);

  // Fallback for SPA routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/metrics')) {
      return next();
    }
    const resolvedIndex = [
      path.join(publicPath, 'index.html'),
      path.resolve(process.cwd(), 'public', 'index.html'),
      path.resolve(__dirname, '..', 'public', 'index.html'),
      path.resolve(__dirname, '..', '..', 'public', 'index.html'),
    ].find((p) => fs.existsSync(p));

    if (resolvedIndex) {
      return res.sendFile(resolvedIndex);
    }
    res.status(404).send('ShipOps UI index.html not found');
  });

  // WebSocket connection handler
  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pipelineRunId = url.searchParams.get('runId') || 'global';
    streamer.registerWebSocket(pipelineRunId, ws);
  });

  return { app, server, wss };
}

export async function startServer() {
  const db = Database.getInstance();
  await db.initialize();

  const { server } = await createServer();

  server.listen(config.port, config.host, () => {
    console.log(`
🚀 =========================================================================
   ShipOps Cloud-Native CI/CD Deployment Platform
=========================================================================
   📡 Server URL:         http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}
   🖥️  Web UI Console:     http://localhost:${config.port}/
   📊 Prometheus Metrics: http://localhost:${config.port}/metrics
   📈 DORA Metrics API:   http://localhost:${config.port}/api/metrics/dora
   🔗 GitHub Webhook:     http://localhost:${config.port}/api/webhooks/github
   📦 Database Backend:   ${db.isPostgresConnected ? 'PostgreSQL' : 'Embedded State Engine'}
=========================================================================
`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Gracefully shutting down ShipOps platform...');
    server.close(() => {
      console.log('✅ ShipOps platform closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  startServer().catch(err => {
    console.error('Failed to start ShipOps server:', err);
    process.exit(1);
  });
}
