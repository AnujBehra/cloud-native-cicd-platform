import { describe, it, expect, beforeAll } from 'vitest';
import { Database } from '../src/db/database.js';
import { HelmManager } from '../src/helm/helm-manager.js';

describe('Helm Manager & 1-Click Rollback Tests', () => {
  const db = Database.getInstance();
  const helm = HelmManager.getInstance();

  beforeAll(async () => {
    await db.initialize();
  });

  it('should lint and validate the order-service Helm chart', async () => {
    const lintRes = await helm.lintAndPackage('run-test-lint', 'order-service', 'charts/order-service');
    expect(lintRes.passed).toBe(true);
    expect(lintRes.renderedManifestsCount).toBe(6);
    expect(lintRes.errors.length).toBe(0);
  });

  it('should deploy a new revision and support 1-click rollback', async () => {
    const releaseName = 'order-service-prod';

    // Deploy revision
    const deployRes = await helm.deploy({
      pipelineRunId: 'run-test-deploy',
      projectName: 'order-service',
      chartPath: 'charts/order-service',
      releaseName,
      namespace: 'production',
      environment: 'production',
      imageTag: 'v2.0.0',
    });

    expect(deployRes.success).toBe(true);
    const revBefore = deployRes.release.revision;

    // Rollback to previous revision
    const rollbackRes = await helm.rollback(releaseName, 1, 'production', 'test-operator');
    expect(rollbackRes.success).toBe(true);
    expect(rollbackRes.newRevision).toBe(revBefore + 1);

    // Verify latest release status
    const releases = await db.getHelmReleases(releaseName, 'production');
    expect(releases[0].revision).toBe(rollbackRes.newRevision);
    expect(releases[0].status).toBe('deployed');
  });
});
