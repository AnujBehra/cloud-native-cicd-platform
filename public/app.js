const deploymentsEl = document.querySelector("#deployments");
const eventsEl = document.querySelector("#events");
const form = document.querySelector("#deploy-form");
const refreshButton = document.querySelector("#refresh");
const formStatus = document.querySelector("#form-status");
const deploymentCount = document.querySelector("#deployment-count");
const presetButtons = document.querySelectorAll(".preset");
const selectedIdEl = document.querySelector("#selected-id");
const statTotal = document.querySelector("#stat-total");
const statDeployed = document.querySelector("#stat-deployed");
const statRunning = document.querySelector("#stat-running");
const statFailed = document.querySelector("#stat-failed");
const queueStatus = document.querySelector("#queue-status");

let selectedDeploymentId = null;
let loading = false;

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadDeployments() {
  if (loading) return;
  loading = true;
  try {
    const deployments = await request("/api/deployments");
    const queue = await request("/api/queue");
    queueStatus.textContent = `${queue.active} active / ${queue.pending} pending`;
    renderSummary(deployments);
    renderDeployments(deployments);

    if (selectedDeploymentId) {
      await loadDeployment(selectedDeploymentId);
    } else if (deployments[0]) {
      await loadDeployment(deployments[0].id);
    }
  } finally {
    loading = false;
  }
}

function renderSummary(deployments) {
  statTotal.textContent = deployments.length;
  statDeployed.textContent = deployments.filter((item) => item.status === "deployed").length;
  statRunning.textContent = deployments.filter((item) => ["queued", "running"].includes(item.status)).length;
  statFailed.textContent = deployments.filter((item) => item.status === "failed").length;
  deploymentCount.textContent = String(deployments.length);
}

function renderDeployments(deployments) {
  deploymentsEl.innerHTML = "";

  if (deployments.length === 0) {
    deploymentsEl.innerHTML = '<p class="empty">No deployments yet. Trigger a real public GitHub repo to start the first pipeline.</p>';
    return;
  }

  deployments.forEach((deployment) => {
    const button = document.createElement("button");
    button.className = `deployment ${deployment.id === selectedDeploymentId ? "selected" : ""}`;
    button.type = "button";
    button.dataset.id = deployment.id;
    button.innerHTML = `
      <span class="deployment-main">
        <strong>${escapeHtml(deployment.repository)}</strong>
        <span class="muted">${escapeHtml(deployment.branch)} @ ${escapeHtml(deployment.commit_sha.slice(0, 7))} · ${escapeHtml(deployment.environment)}</span>
      </span>
      <span class="deployment-meta">
        <span class="status ${escapeHtml(deployment.status)}">${escapeHtml(deployment.status)}</span>
        <time>${formatDate(deployment.created_at)}</time>
      </span>
    `;
    button.addEventListener("click", () => loadDeployment(deployment.id));
    deploymentsEl.appendChild(button);
  });
}

async function loadDeployment(id) {
  selectedDeploymentId = id;
  const deployment = await request(`/api/deployments/${id}`);
  selectedIdEl.textContent = deployment.id;
  eventsEl.classList.remove("empty");
  eventsEl.innerHTML = `
    <div class="detail-header">
      <div>
        <strong>${escapeHtml(deployment.repository)}</strong>
        <span>${escapeHtml(deployment.branch)} @ ${escapeHtml(deployment.commit_sha.slice(0, 12))}</span>
      </div>
      <span class="status ${escapeHtml(deployment.status)}">${escapeHtml(deployment.status)}</span>
    </div>
    <div class="event-list">
      ${deployment.events.map(renderEvent).join("")}
    </div>
    ${renderActions(deployment)}
    ${renderAccessHint(deployment)}
  `;

  document.querySelectorAll(".deployment").forEach((button) => {
    button.classList.toggle("selected", button.dataset.id === deployment.id);
  });
}

function renderEvent(event) {
  const statusClass = event.status === "failed" ? "failed" : event.status === "running" ? "running" : "deployed";
  const logs = event.logs ? `
    <details class="logs">
      <summary>Raw logs</summary>
      <pre>${escapeHtml(event.logs)}</pre>
    </details>
  ` : "";
  return `
    <div class="event">
      <span class="event-stage">${escapeHtml(event.stage)}</span>
      <span class="status ${statusClass}">${escapeHtml(event.status)}</span>
      <span class="event-message">${escapeHtml(event.message)}${logs}</span>
    </div>
  `;
}

function renderActions(deployment) {
  if (!["deployed", "failed", "rolled_back"].includes(deployment.status)) return "";
  return `
    <div class="actions">
      <button type="button" class="secondary danger" data-action="rollback" data-id="${escapeHtml(deployment.id)}">Rollback Helm Release</button>
    </div>
  `;
}

function renderAccessHint(deployment) {
  if (deployment.status !== "deployed") return "";
  const repo = deployment.repository.toLowerCase();
  if (repo.includes("multiservice-docker-platform")) {
    return commandBlock("Open Kubernetes web service", "kubectl -n apps-anujbehra-multiservice-docker-platform-st port-forward svc/web 8090:80");
  }
  if (repo.includes("3d-solar-system")) {
    return commandBlock("Open Kubernetes app service", "kubectl -n apps port-forward svc/app-anujbehra-3d-solar-system-staging-deployed-app 8089:80");
  }
  if (repo.includes("portfolio")) {
    return commandBlock("Open Kubernetes app service", "kubectl -n apps port-forward svc/app-anujbehra-portfolio-staging-deployed-app 8088:80");
  }
  return "";
}

function commandBlock(title, command) {
  return `
    <div class="access">
      <strong>${escapeHtml(title)}</strong>
      <code>${escapeHtml(command)}</code>
    </div>
  `;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  const apiKey = body.api_key;
  delete body.api_key;
  if (!body.commit_sha) delete body.commit_sha;

  formStatus.textContent = "Resolving repository and queueing pipeline...";
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const deployment = await request("/api/deployments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {})
      },
      body: JSON.stringify(body)
    });
    selectedDeploymentId = deployment.id;
    formStatus.textContent = `Queued ${deployment.repository} @ ${deployment.commit_sha.slice(0, 7)}`;
    await loadDeployments();
  } catch (error) {
    formStatus.textContent = friendlyError(error);
  } finally {
    form.querySelector('button[type="submit"]').disabled = false;
  }
});

eventsEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='rollback']");
  if (!button) return;
  const apiKey = form.elements.api_key.value;
  button.disabled = true;
  button.textContent = "Rolling back...";
  try {
    await request(`/api/deployments/${button.dataset.id}/rollback`, {
      method: "POST",
      headers: {
        ...(apiKey ? { "x-api-key": apiKey } : {})
      }
    });
    formStatus.textContent = "Rollback completed";
    await loadDeployment(button.dataset.id);
    await loadDeployments();
  } catch (error) {
    formStatus.textContent = friendlyError(error);
    button.disabled = false;
    button.textContent = "Rollback Helm Release";
  }
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    form.elements.repository.value = button.dataset.repository;
    form.elements.branch.value = button.dataset.branch;
    form.elements.environment.value = button.dataset.environment;
    form.elements.commit_sha.value = "";
    formStatus.textContent = "";
  });
});

function friendlyError(error) {
  try {
    const parsed = JSON.parse(error.message);
    return parsed.error || error.message;
  } catch (_parseError) {
    return error.message;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refreshButton.addEventListener("click", loadDeployments);
setInterval(loadDeployments, 3000);
loadDeployments();
