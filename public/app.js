// ShipOps Frontend JavaScript Engine

let currentTab = 'pipelines';
let currentPipelineRunId = null;
let activeEventSource = null;
let activeWebSocket = null;
let currentRollbackTarget = { releaseName: '', revision: 1 };

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  // Auto refresh pipelines and status every 4 seconds
  setInterval(() => {
    if (currentTab === 'pipelines') loadPipelines(false);
    if (currentTab === 'k8s') loadK8sPods();
  }, 4000);
});

async function initApp() {
  await checkHealth();
  await loadPipelines(true);
  await loadDeployments();
  await loadK8sPods();
  await loadDoraMetrics();
}

// Health check
async function checkHealth() {
  try {
    const res = await fetch('/healthz');
    const data = await res.json();
    const badge = document.getElementById('db-status-badge');
    if (badge) {
      badge.textContent = data.postgresConnected ? 'PostgreSQL' : 'Embedded Engine';
      badge.className = data.postgresConnected ? 'font-medium text-emerald-400' : 'font-medium text-amber-400';
    }
  } catch (err) {
    console.error('Health check failed', err);
  }
}

// Tab Switching
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active', 'bg-slate-800', 'text-white'));
  
  const targetSection = document.getElementById(`tab-${tabId}`);
  if (targetSection) targetSection.classList.remove('hidden');

  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.add('active', 'bg-slate-800', 'text-white');
    activeBtn.classList.remove('text-slate-400');
  }

  if (tabId === 'deployments') loadDeployments();
  if (tabId === 'k8s') loadK8sPods();
  if (tabId === 'dora') loadDoraMetrics();
}

// ----------------------------------------------------
// PIPELINES & RUNS
// ----------------------------------------------------
async function loadPipelines(selectFirst = false) {
  try {
    const res = await fetch('/api/pipelines?limit=20');
    const json = await res.json();
    if (!json.success) return;

    const runs = json.data;
    renderPipelineStats(runs);
    renderPipelineList(runs);

    if (runs.length > 0) {
      if (selectFirst && !currentPipelineRunId) {
        selectPipelineRun(runs[0].id);
      } else if (currentPipelineRunId) {
        const active = runs.find(r => r.id === currentPipelineRunId);
        if (active) renderPipelineHeader(active);
      }
    }
  } catch (err) {
    console.error('Failed to load pipelines', err);
  }
}

function renderPipelineStats(runs) {
  const activeCount = runs.filter(r => r.status === 'running' || r.status === 'queued').length;
  const passedCount = runs.filter(r => r.status === 'passed').length;
  const rate = runs.length > 0 ? ((passedCount / runs.length) * 100).toFixed(1) : '100';

  document.getElementById('stat-active-pipelines').textContent = activeCount;
  document.getElementById('stat-total-runs').textContent = runs.length;
  document.getElementById('stat-success-rate').textContent = `${rate}%`;
}

function renderPipelineList(runs) {
  const container = document.getElementById('pipeline-runs-container');
  if (!container) return;

  if (runs.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-slate-500 text-xs">No pipeline runs yet. Click "Trigger Build" above!</div>';
    return;
  }

  container.innerHTML = runs.map(run => {
    const isSelected = run.id === currentPipelineRunId;
    const statusBg = run.status === 'passed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                     run.status === 'running' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20 animate-pulse' :
                     run.status === 'failed' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                     'bg-slate-800 text-slate-400 border-slate-700';

    const triggerIcon = run.triggerType === 'github_push' ? '<i class="fa-brands fa-github text-sky-400"></i> push' :
                        run.triggerType === 'github_pr' ? '<i class="fa-solid fa-code-pull-request text-indigo-400"></i> PR' :
                        run.triggerType === 'manual' ? '<i class="fa-solid fa-hand text-amber-400"></i> manual' :
                        '<i class="fa-solid fa-bolt text-purple-400"></i> ' + run.triggerType;

    const durationStr = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : (run.status === 'running' ? 'running...' : 'queued');

    return `
      <div onclick="selectPipelineRun('${run.id}')" class="p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected ? 'bg-slate-800/90 border-sky-500/50 shadow-md shadow-sky-500/10' : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
      }">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="font-bold text-xs text-white font-mono">${run.projectName || 'order-service'}</span>
            <span class="text-[10px] font-mono text-slate-400">#${run.id.substring(4)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono bg-slate-800 text-slate-300">${run.branch}</span>
          </div>
          <span class="text-[11px] px-2 py-0.5 rounded-full font-semibold border ${statusBg}">${run.status}</span>
        </div>

        <p class="text-[11px] text-slate-400 truncate mt-1.5">${run.commitMessage}</p>

        <div class="flex items-center justify-between text-[10px] text-slate-500 mt-2 pt-1.5 border-t border-slate-800/50">
          <span class="flex items-center space-x-1">${triggerIcon}</span>
          <span class="font-mono text-slate-400"><i class="fa-regular fa-clock"></i> ${durationStr}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function selectPipelineRun(runId) {
  currentPipelineRunId = runId;
  loadPipelines(false);

  try {
    const res = await fetch(`/api/pipelines/${runId}`);
    const json = await res.json();
    if (!json.success) return;

    const run = json.data;
    renderPipelineHeader(run);
    renderStagesStepper(run.stages);
    connectLogStream(runId);
  } catch (err) {
    console.error('Failed to select pipeline run', err);
  }
}

function renderPipelineHeader(run) {
  document.getElementById('selected-run-id').textContent = run.id;
  const statusEl = document.getElementById('selected-run-status');
  statusEl.textContent = run.status;
  statusEl.className = `px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
    run.status === 'passed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
    run.status === 'running' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20 animate-pulse' :
    run.status === 'failed' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
    'bg-slate-800 text-slate-400 border-slate-700'
  }`;

  document.getElementById('selected-run-env').textContent = run.targetEnvironment;
  document.getElementById('selected-run-meta').innerHTML = `
    Commit <span class="font-mono text-sky-300 font-bold">${run.commitSha}</span> • 
    branch <span class="font-semibold text-slate-200">${run.branch}</span> • 
    author <span class="text-slate-300 font-medium">${run.author}</span> • 
    tag <span class="font-mono text-purple-300">${run.imageTag || 'latest'}</span>
  `;

  document.getElementById('selected-run-duration').textContent = `Duration: ${
    run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : 'in progress...'
  }`;
  document.getElementById('selected-run-time').textContent = new Date(run.startedAt).toLocaleTimeString();
}

function renderStagesStepper(stages) {
  const container = document.getElementById('stages-stepper-container');
  if (!container) return;

  container.innerHTML = stages.map(stage => {
    const icon = stage.status === 'passed' ? '<i class="fa-solid fa-circle-check text-emerald-400"></i>' :
                 stage.status === 'running' ? '<i class="fa-solid fa-spinner fa-spin text-sky-400"></i>' :
                 stage.status === 'failed' ? '<i class="fa-solid fa-circle-xmark text-rose-400"></i>' :
                 '<i class="fa-regular fa-circle text-slate-600"></i>';

    const durationText = stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : (stage.status === 'running' ? 'running...' : 'queued');

    return `
      <div class="stage-card p-2.5 rounded-lg border text-xs flex flex-col justify-between ${stage.status}">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-slate-200 text-[11px] truncate">${stage.displayName}</span>
          <span>${icon}</span>
        </div>
        <div class="flex items-center justify-between text-[10px] text-slate-400 mt-2 font-mono">
          <span class="capitalize ${stage.status === 'passed' ? 'text-emerald-400 font-semibold' : ''}">${stage.status}</span>
          <span>${durationText}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// REAL-TIME LOG STREAMING (SSE & WebSocket)
// ----------------------------------------------------
function connectLogStream(runId) {
  const terminal = document.getElementById('terminal-window');
  terminal.innerHTML = '<div class="text-slate-500 italic">Streaming logs from pipeline worker...</div>';

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  activeEventSource = new EventSource(`/api/pipelines/${runId}/stream`);

  activeEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      appendTerminalLog(data);
    } catch (e) {
      appendTerminalLog({ message: event.data });
    }
  };

  activeEventSource.addEventListener('status_change', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (currentPipelineRunId === runId) {
        selectPipelineRun(runId);
      }
    } catch (e) {}
  });

  activeEventSource.onerror = () => {
    // Falls back gracefully
  };
}

function appendTerminalLog(log) {
  const terminal = document.getElementById('terminal-window');
  if (!terminal) return;

  const line = document.createElement('div');
  line.className = 'py-0.5 leading-relaxed break-all';
  line.innerHTML = formatAnsi(log.message || '');
  terminal.appendChild(line);

  const autoScroll = document.getElementById('auto-scroll-toggle')?.checked;
  if (autoScroll) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function formatAnsi(text) {
  // Convert ANSI escape sequences to styled HTML spans
  return text
    .replace(/\x1b\[1;34m/g, '<span class="ansi-bold ansi-blue">')
    .replace(/\x1b\[1;32m/g, '<span class="ansi-bold ansi-green">')
    .replace(/\x1b\[1;31m/g, '<span class="ansi-bold ansi-red">')
    .replace(/\x1b\[32m/g, '<span class="ansi-green">')
    .replace(/\x1b\[34m/g, '<span class="ansi-blue">')
    .replace(/\x1b\[36m/g, '<span class="ansi-cyan">')
    .replace(/\x1b\[33m/g, '<span class="ansi-yellow">')
    .replace(/\x1b\[31m/g, '<span class="ansi-red">')
    .replace(/\x1b\[0m/g, '</span>');
}

function copyLogs() {
  const terminal = document.getElementById('terminal-window');
  if (terminal) {
    navigator.clipboard.writeText(terminal.innerText);
    alert('Logs copied to clipboard!');
  }
}

// ----------------------------------------------------
// DEPLOYMENTS & HELM ROLLBACK
// ----------------------------------------------------
async function loadDeployments() {
  try {
    const envFilter = document.getElementById('deploy-env-filter')?.value || '';
    const res = await fetch(`/api/deployments${envFilter ? `?environment=${envFilter}` : ''}`);
    const json = await res.json();
    if (!json.success) return;

    const tbody = document.getElementById('deployments-table-body');
    if (!tbody) return;

    if (json.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-slate-500">No deployments found.</td></tr>';
      return;
    }

    tbody.innerHTML = json.data.map(dep => {
      const statusBadge = dep.status === 'active' 
        ? '<span class="px-2 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">active</span>'
        : dep.status === 'superseded'
        ? '<span class="px-2 py-0.5 rounded text-slate-400 bg-slate-800">superseded</span>'
        : '<span class="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">failed</span>';

      return `
        <tr class="hover:bg-slate-850 transition-colors">
          <td class="py-3 px-3 font-bold text-white">${dep.helmReleaseName}</td>
          <td class="py-3 px-3"><span class="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-indigo-300 font-semibold">${dep.environment}</span></td>
          <td class="py-3 px-3 text-sky-400 font-bold">Revision ${dep.helmRevision}</td>
          <td class="py-3 px-3 text-purple-300 font-mono">${dep.imageTag}</td>
          <td class="py-3 px-3">${statusBadge}</td>
          <td class="py-3 px-3 text-slate-400">${dep.deployedBy}</td>
          <td class="py-3 px-3 text-slate-400">${new Date(dep.deployedAt).toLocaleString()}</td>
          <td class="py-3 px-3 text-right space-x-1">
            <button onclick="promptRollback('${dep.helmReleaseName}', ${dep.helmRevision > 1 ? dep.helmRevision - 1 : 1})" class="px-2.5 py-1 text-[11px] font-semibold rounded bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 transition-all">
              <i class="fa-solid fa-rotate-left"></i> Rollback
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load deployments', err);
  }
}

function promptRollback(releaseName, targetRev) {
  currentRollbackTarget = { releaseName, revision: targetRev };
  document.getElementById('rollback-release-name').textContent = releaseName;
  document.getElementById('rollback-target-rev').textContent = targetRev;
  document.getElementById('rollback-modal').classList.remove('hidden');
}

function closeRollbackModal() {
  document.getElementById('rollback-modal').classList.add('hidden');
}

async function executeRollback() {
  closeRollbackModal();
  try {
    const res = await fetch('/api/deployments/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        releaseName: currentRollbackTarget.releaseName,
        targetRevision: currentRollbackTarget.revision,
        namespace: 'production',
        actor: 'web-console-operator',
      }),
    });

    const json = await res.json();
    if (json.success) {
      alert(`Rollback Successful! Release upgraded to new active revision ${json.data.newRevision}.`);
      loadDeployments();
      loadK8sPods();
    } else {
      alert(`Rollback failed: ${json.error}`);
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ----------------------------------------------------
// KUBERNETES PODS INSPECTOR
// ----------------------------------------------------
async function loadK8sPods() {
  try {
    const ns = document.getElementById('k8s-namespace-select')?.value || 'production';
    const res = await fetch(`/api/k8s/pods?namespace=${ns}`);
    const json = await res.json();
    if (!json.success) return;

    const grid = document.getElementById('k8s-pods-grid');
    if (!grid) return;

    if (json.data.length === 0) {
      grid.innerHTML = '<div class="col-span-4 text-center py-10 text-slate-500">No active pods in this namespace.</div>';
      return;
    }

    grid.innerHTML = json.data.map(pod => `
      <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 shadow-sm space-y-3 font-mono text-xs">
        <div class="flex items-center justify-between">
          <span class="font-bold text-white truncate max-w-[180px]" title="${pod.name}">${pod.name}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${
            pod.status === 'Running' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-amber-500/10 text-amber-400'
          }">${pod.status}</span>
        </div>

        <div class="space-y-1 text-[11px] text-slate-400">
          <div class="flex justify-between"><span>Node:</span> <span class="text-slate-200">${pod.node}</span></div>
          <div class="flex justify-between"><span>IP:</span> <span class="text-sky-400">${pod.ip}</span></div>
          <div class="flex justify-between"><span>CPU / Mem:</span> <span class="text-purple-300">${pod.cpuUsage} / ${pod.memoryUsage}</span></div>
          <div class="flex justify-between"><span>Restarts:</span> <span class="text-emerald-400 font-bold">${pod.restarts}</span></div>
        </div>

        <div class="pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500">
          <span class="flex items-center space-x-1 text-emerald-400">
            <i class="fa-solid fa-heart-pulse"></i> <span>Ready (1/1)</span>
          </span>
          <span>Age: ${pod.age}</span>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load pods', err);
  }
}

// ----------------------------------------------------
// DORA METRICS
// ----------------------------------------------------
async function loadDoraMetrics() {
  try {
    const res = await fetch('/api/metrics/dora');
    const json = await res.json();
    if (!json.success) return;

    const d = json.data;
    document.getElementById('dora-df-val').textContent = d.deploymentFrequency.value;
    document.getElementById('dora-df-unit').textContent = d.deploymentFrequency.unit;
    document.getElementById('dora-df-rating').textContent = d.deploymentFrequency.rating;

    document.getElementById('dora-lt-val').textContent = d.leadTimeForChanges.formatted;
    document.getElementById('dora-lt-rating').textContent = d.leadTimeForChanges.rating;

    document.getElementById('dora-cfr-val').textContent = `${d.changeFailureRate.valuePercent}%`;
    document.getElementById('dora-cfr-rating').textContent = d.changeFailureRate.rating;

    document.getElementById('dora-mttr-val').textContent = d.meanTimeToRestore.formatted;
  } catch (err) {
    console.error('Failed to load DORA metrics', err);
  }
}

// ----------------------------------------------------
// TRIGGER MODALS & SIMULATOR
// ----------------------------------------------------
function openTriggerModal() {
  document.getElementById('trigger-modal').classList.remove('hidden');
}

function closeTriggerModal() {
  document.getElementById('trigger-modal').classList.add('hidden');
}

async function submitTriggerBuild(e) {
  e.preventDefault();
  const projectId = document.getElementById('trigger-project').value;
  const targetEnvironment = document.getElementById('trigger-environment').value;
  const branch = document.getElementById('trigger-branch').value;
  const customImageTag = document.getElementById('trigger-tag').value || undefined;
  const commitMessage = document.getElementById('trigger-message').value;

  closeTriggerModal();

  try {
    const res = await fetch('/api/pipelines/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        targetEnvironment,
        branch,
        customImageTag,
        commitMessage,
        author: 'web-user',
      }),
    });

    const json = await res.json();
    if (json.success) {
      switchTab('pipelines');
      await loadPipelines(false);
      selectPipelineRun(json.data.id);
    }
  } catch (err) {
    alert(`Failed to trigger build: ${err.message}`);
  }
}

async function quickSimulatePush() {
  try {
    const res = await fetch('/api/simulator/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: 'order-service', branch: 'main' }),
    });
    const json = await res.json();
    if (json.success) {
      switchTab('pipelines');
      await loadPipelines(false);
      selectPipelineRun(json.pipelineRun.id);
    }
  } catch (err) {
    alert(`Simulation error: ${err.message}`);
  }
}

async function triggerSimulatedEvent(type) {
  if (type === 'push_main') {
    await quickSimulatePush();
  } else if (type === 'pr') {
    const res = await fetch('/api/simulator/pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectName: 'order-service', branch: 'feat/payment-retry', prNumber: 42 }),
    });
    const json = await res.json();
    if (json.success) {
      switchTab('pipelines');
      await loadPipelines(false);
      selectPipelineRun(json.pipelineRun.id);
    }
  } else if (type === 'staging') {
    const res = await fetch('/api/pipelines/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-order-service',
        targetEnvironment: 'staging',
        branch: 'staging',
        commitMessage: 'chore(staging): deploy staging release candidate',
        author: 'release-manager',
      }),
    });
    const json = await res.json();
    if (json.success) {
      switchTab('pipelines');
      await loadPipelines(false);
      selectPipelineRun(json.data.id);
    }
  }
}
