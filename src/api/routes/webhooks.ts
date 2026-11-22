import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Database } from '../../db/database.js';
import { JobQueue } from '../../engine/job-queue.js';
import { config } from '../../config/index.js';

export const webhooksRouter = Router();
const db = Database.getInstance();
const queue = JobQueue.getInstance();

// Verify HMAC SHA256 signature
function verifyGitHubSignature(payload: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = `sha256=${hmac.update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

// POST /api/webhooks/github
webhooksRouter.post('/github', async (req: Request, res: Response) => {
  try {
    const event = req.headers['x-github-event'] as string;
    const signature = req.headers['x-hub-signature-256'] as string;
    const rawPayload = JSON.stringify(req.body);

    if (event === 'ping') {
      return res.status(200).json({ success: true, message: 'Pong! Webhook successfully registered.' });
    }

    const { repository, ref, head_commit, commits, sender, pull_request, action } = req.body;
    if (!repository || !repository.name) {
      return res.status(400).json({ success: false, error: 'Malformed repository payload' });
    }

    // Lookup project
    let project = await db.getProjectByName(repository.name);
    if (!project) {
      // Auto-register project if not exists
      project = await db.createProject({
        id: `proj-${repository.name}`,
        name: repository.name,
        repoUrl: repository.clone_url || repository.html_url || `https://github.com/${repository.full_name}`,
        defaultBranch: repository.default_branch || 'main',
        helmChartPath: `charts/${repository.name}`,
        dockerfilePath: 'Dockerfile',
        environments: ['development', 'staging', 'production'],
        webhookSecret: config.webhook.secret,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Verify signature if secret provided
    const secret = project.webhookSecret || config.webhook.secret;
    if (signature && !verifyGitHubSignature(rawPayload, signature, secret)) {
      return res.status(401).json({ success: false, error: 'Invalid HMAC signature' });
    }

    let branch = 'main';
    let commitSha = 'HEAD';
    let commitMessage = 'Triggered via GitHub webhook';
    let author = sender?.login || 'github-user';
    let triggerType: 'github_push' | 'github_pr' = 'github_push';

    if (event === 'push' || !event) {
      branch = ref ? ref.replace('refs/heads/', '') : (project.defaultBranch || 'main');
      commitSha = head_commit?.id?.substring(0, 8) || (commits && commits[0]?.id?.substring(0, 8)) || Math.random().toString(36).substring(2, 10);
      commitMessage = head_commit?.message || (commits && commits[0]?.message) || `Push to ${branch}`;
      author = head_commit?.author?.name || sender?.login || 'git-author';
      triggerType = 'github_push';
    } else if (event === 'pull_request') {
      branch = pull_request?.head?.ref || 'feature-branch';
      commitSha = pull_request?.head?.sha?.substring(0, 8) || Math.random().toString(36).substring(2, 10);
      commitMessage = `PR #${pull_request?.number || 1}: ${pull_request?.title || 'Feature update'}`;
      author = pull_request?.user?.login || sender?.login || 'pr-author';
      triggerType = 'github_pr';
    }

    // Target environment logic: main/master -> production, staging -> staging, others -> development
    const targetEnvironment = branch === 'main' || branch === 'master' 
      ? 'production' 
      : branch === 'staging' 
      ? 'staging' 
      : 'development';

    const run = await queue.enqueue({
      projectId: project.id,
      triggerType,
      branch,
      commitSha,
      commitMessage,
      author,
      targetEnvironment,
    });

    res.status(202).json({
      success: true,
      message: `Webhook accepted. Queued pipeline execution ${run.id}`,
      pipelineRunId: run.id,
      project: project.name,
      branch,
      targetEnvironment,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
