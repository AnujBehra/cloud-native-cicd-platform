#!/usr/bin/env node

const API_BASE = process.env.SHIPOPS_API_URL || 'http://localhost:4000';

async function request(endpoint: string, options: any = {}): Promise<any> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return await res.json();
  } catch (err: any) {
    console.error(`\x1b[31mError connecting to ShipOps at ${url}: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const subcommand = args[1];

  if (!command || command === 'help' || command === '--help') {
    console.log(`
\x1b[1;36mShipOps CLI (shipctl) - Cloud-Native CI/CD Orchestration Tool\x1b[0m

\x1b[1mUsage:\x1b[0m
  shipctl <command> <subcommand> [options]

\x1b[1mCommands:\x1b[0m
  \x1b[33mprojects list\x1b[0m                                List registered projects
  \x1b[33mpipeline run <projectName> [env]\x1b[0m              Trigger a new pipeline build & deploy
  \x1b[33mpipeline list\x1b[0m                                 List recent pipeline runs
  \x1b[33mpipeline logs <runId>\x1b[0m                         Fetch build & deployment logs
  \x1b[33mdeployments list [env]\x1b[0m                        List active and past deployments
  \x1b[33mrollback <releaseName> <revision>\x1b[0m             Instant 1-click Helm release rollback
  \x1b[33mk8s pods [namespace]\x1b[0m                          Inspect Kubernetes pod workloads
  \x1b[33mmetrics dora\x1b[0m                                  Display DevOps DORA metrics
`);
    return;
  }

  if (command === 'projects' && subcommand === 'list') {
    const res = await request('/api/projects');
    console.log('\x1b[1;32mRegistered Projects:\x1b[0m');
    console.table(res.data.map((p: any) => ({
      ID: p.id,
      Name: p.name,
      Branch: p.defaultBranch,
      Chart: p.helmChartPath,
      Environments: p.environments.join(', '),
    })));
    return;
  }

  if (command === 'pipeline' && (subcommand === 'run' || subcommand === 'trigger')) {
    const projectName = args[2] || 'order-service';
    const env = args[3] || 'production';

    const projRes = await request(`/api/projects`);
    const project = projRes.data.find((p: any) => p.name === projectName || p.id === projectName);
    if (!project) {
      console.error(`\x1b[31mProject "${projectName}" not found.\x1b[0m`);
      return;
    }

    console.log(`\x1b[36m🚀 Triggering pipeline for ${projectName} (Environment: ${env})...\x1b[0m`);
    const triggerRes = await request('/api/pipelines/trigger', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        targetEnvironment: env,
        author: process.env.USER || 'shipctl-user',
        commitMessage: `Triggered manually via shipctl CLI`,
      }),
    });

    console.log(`\x1b[32m✔ Pipeline queued successfully! Run ID: ${triggerRes.data.id}\x1b[0m`);
    console.log(`\x1b[33mView live logs: shipctl pipeline logs ${triggerRes.data.id}\x1b[0m`);
    return;
  }

  if (command === 'pipeline' && subcommand === 'list') {
    const res = await request('/api/pipelines?limit=10');
    console.log('\x1b[1;32mRecent Pipeline Runs:\x1b[0m');
    console.table(res.data.map((r: any) => ({
      RunID: r.id,
      Project: r.projectName,
      Branch: r.branch,
      Trigger: r.triggerType,
      Status: r.status,
      Env: r.targetEnvironment,
      Duration: r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : 'running...',
      Started: new Date(r.startedAt).toLocaleTimeString(),
    })));
    return;
  }

  if (command === 'pipeline' && subcommand === 'logs') {
    const runId = args[2];
    if (!runId) {
      console.error('\x1b[31mRun ID is required. Example: shipctl pipeline logs run-12345\x1b[0m');
      return;
    }

    const res = await request(`/api/pipelines/${runId}/logs`);
    console.log(`\x1b[1;36m=== Live Logs for Pipeline [${runId}] ===\x1b[0m\n`);
    for (const log of res.data) {
      console.log(`[${log.stageName}] ${log.message}`);
    }
    return;
  }

  if (command === 'deployments' && subcommand === 'list') {
    const env = args[2];
    const res = await request(`/api/deployments${env ? `?environment=${env}` : ''}`);
    console.log('\x1b[1;32mKubernetes Deployments & Helm Releases:\x1b[0m');
    console.table(res.data.map((d: any) => ({
      ID: d.id,
      Project: d.projectName,
      Env: d.environment,
      Release: d.helmReleaseName,
      Revision: `Rev ${d.helmRevision}`,
      ImageTag: d.imageTag,
      Status: d.status,
      DeployedAt: new Date(d.deployedAt).toLocaleString(),
    })));
    return;
  }

  if (command === 'rollback') {
    const releaseName = args[1];
    const revision = args[2];

    if (!releaseName || !revision) {
      console.error('\x1b[31mUsage: shipctl rollback <releaseName> <targetRevision>\x1b[0m');
      console.error('Example: shipctl rollback order-service-prod 1');
      return;
    }

    console.log(`\x1b[33m⏪ Rolling back Helm release "${releaseName}" to revision ${revision}...\x1b[0m`);
    const res = await request('/api/deployments/rollback', {
      method: 'POST',
      body: JSON.stringify({
        releaseName,
        targetRevision: parseInt(revision, 10),
        namespace: 'production',
        actor: process.env.USER || 'shipctl-cli',
      }),
    });

    if (res.success) {
      console.log(`\x1b[32m✔ ${res.data.message}\x1b[0m`);
    } else {
      console.error(`\x1b[31m✖ Rollback failed: ${res.error}\x1b[0m`);
    }
    return;
  }

  if (command === 'k8s' && subcommand === 'pods') {
    const ns = args[2] || 'production';
    const res = await request(`/api/k8s/pods?namespace=${ns}`);
    console.log(`\x1b[1;32mKubernetes Pods in Namespace [${ns}]:\x1b[0m`);
    console.table(res.data.map((p: any) => ({
      PodName: p.name,
      Status: p.status,
      Ready: p.ready ? '✔ Ready' : '✖ Not Ready',
      Restarts: p.restarts,
      Node: p.node,
      IP: p.ip,
      CPU: p.cpuUsage,
      Memory: p.memoryUsage,
    })));
    return;
  }

  if (command === 'metrics' && subcommand === 'dora') {
    const res = await request('/api/metrics/dora');
    const d = res.data;
    console.log('\x1b[1;35m====================================================\x1b[0m');
    console.log('\x1b[1;35m           DevOps DORA Metrics Report               \x1b[0m');
    console.log('\x1b[1;35m====================================================\x1b[0m');
    console.log(` 1. Deployment Frequency:  \x1b[32m${d.deploymentFrequency.value} ${d.deploymentFrequency.unit}\x1b[0m (${d.deploymentFrequency.rating})`);
    console.log(` 2. Lead Time for Changes: \x1b[32m${d.leadTimeForChanges.formatted}\x1b[0m (${d.leadTimeForChanges.rating})`);
    console.log(` 3. Change Failure Rate:   \x1b[32m${d.changeFailureRate.valuePercent}%\x1b[0m (${d.changeFailureRate.rating})`);
    console.log(` 4. Mean Time to Restore:  \x1b[32m${d.meanTimeToRestore.formatted}\x1b[0m (${d.meanTimeToRestore.rating})`);
    console.log('\x1b[1;35m====================================================\x1b[0m');
    return;
  }

  console.log(`\x1b[31mUnknown command: ${command} ${subcommand}\x1b[0m. Run \x1b[33mshipctl --help\x1b[0m for usage.`);
}

main();
