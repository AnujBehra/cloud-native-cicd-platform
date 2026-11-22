import express from 'express';
import client from 'prom-client';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(express.json());

// Prometheus Metrics
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'order_service_' });

const orderCounter = new client.Counter({
  name: 'orders_created_total',
  help: 'Total number of e-commerce orders created',
  labelNames: ['status'],
  registers: [registry],
});

// Liveness Probe
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

// Readiness Probe
app.get('/ready', (req, res) => {
  res.status(200).json({ ready: true, database: 'connected' });
});

// Prometheus Endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});

// Order Processing API
app.get('/api/orders', (req, res) => {
  res.json({
    orders: [
      { id: 'ord-101', item: 'Cloud-Native DevOps Guide', price: 49.99, status: 'confirmed' },
      { id: 'ord-102', item: 'Kubernetes Production Blueprint', price: 89.00, status: 'shipped' },
    ],
  });
});

app.post('/api/orders', (req, res) => {
  const { item, price } = req.body;
  orderCounter.inc({ status: 'success' });
  res.status(201).json({ id: `ord-${Date.now()}`, item, price, status: 'created' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Order Service running on http://0.0.0.0:${port}`);
});
