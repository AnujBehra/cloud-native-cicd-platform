import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'shipops',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
  },
  k8s: {
    kubeconfigPath: process.env.KUBECONFIG || path.join(process.env.HOME || '~', '.kube', 'config'),
    inCluster: process.env.KUBERNETES_SERVICE_HOST !== undefined,
    defaultNamespace: process.env.K8S_DEFAULT_NAMESPACE || 'shipops-apps',
    useSimulator: process.env.K8S_USE_SIMULATOR !== 'false', // Defaults to simulator if cluster not detected
  },
  docker: {
    registry: process.env.DOCKER_REGISTRY || 'registry.shipops.internal',
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  },
  webhook: {
    secret: process.env.GITHUB_WEBHOOK_SECRET || 'shipops-secret-token-12345',
  },
  metrics: {
    prefix: 'cicd_',
    collectDefaultMetrics: true,
  },
  workspaceRoot: path.resolve(process.cwd()),
};
