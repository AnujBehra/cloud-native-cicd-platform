import { Router, Request, Response } from 'express';
import { KubernetesEngine } from '../../k8s/k8s-client.js';

export const k8sRouter = Router();
const k8s = KubernetesEngine.getInstance();

// GET /api/k8s/pods
k8sRouter.get('/pods', async (req: Request, res: Response) => {
  try {
    const namespace = (req.query.namespace as string) || 'production';
    const deployment = req.query.deployment as string | undefined;
    const pods = await k8s.getPods(namespace, deployment);
    res.json({ success: true, count: pods.length, data: pods });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/k8s/deployments
k8sRouter.get('/deployments', async (req: Request, res: Response) => {
  try {
    const namespace = (req.query.namespace as string) || 'production';
    const deployments = await k8s.getDeploymentsStatus(namespace);
    res.json({ success: true, count: deployments.length, data: deployments });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
