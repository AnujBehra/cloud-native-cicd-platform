# Walkthrough: Cloud-Native CI/CD Deployment Platform (ShipOps)

We have built and verified a production-grade Cloud-Native CI/CD Deployment Platform (**ShipOps**) powered by **Node.js, Docker, Kubernetes, Helm, PostgreSQL, Prometheus, Grafana, and GitHub Actions**.

---

## 🎯 Resume & Architecture Overview

> **Resume Bullet Formulation:**
> *“Built a production CI/CD deployment platform in TypeScript/Node.js that containerizes applications, executes automated test suites, validates and deploys Helm charts to Kubernetes with zero-downtime rolling updates, supports instant 1-click rollbacks, and exposes real-time telemetry through REST APIs, WebSocket/SSE log streaming, and Prometheus/Grafana DORA dashboards.”*

```mermaid
graph TD
    subgraph Ingestion & Triggers
        Dev[Developer / Git Push / CLI] -->|Webhook / API| Gateway[ShipOps Gateway & API Server]
        GHA[GitHub Actions] -->|HMAC-SHA256 Webhook| Gateway
    end

    subgraph Core Platform [ShipOps Core Engine (Node.js/TypeScript)]
        Gateway --> Auth[HMAC Signature & Security Guard]
        Auth --> Queue[Async Pipeline Queue & Worker Pool]
        Queue --> Runner[Multi-Stage Pipeline Runner]

        Runner --> S1[1. Source Checkout & Workspace]
        Runner --> S2[2. Automated Unit Tests & Quality Gates]
        Runner --> S3[3. Docker Multi-Stage Build & Security Scan]
        Runner --> S4[4. Helm Chart Validation & Package]
        Runner --> S5[5. Kubernetes Deploy & Rollout]
        Runner --> S6[6. Health Check & Smoke Probe]

        Runner --> Streamer[Real-Time ANSI Log Streamer - WS/SSE]
    end

    subgraph Storage & Observability
        Gateway <--> DB[(PostgreSQL Database)]
        Runner --> DB
        Runner --> PromRegistry[Prometheus Metrics Exporter]
        Prometheus[Prometheus Server] -->|Scrapes /metrics| Gateway
        Grafana[Grafana Dashboard] -->|Pre-provisioned Visualizations| Prometheus
    end

    subgraph Target Kubernetes Cluster
        S5 --> Helm[Helm Release Manager]
        Helm --> K8s[Kubernetes Cluster: Prod/Staging/Dev]
        K8s --> Workloads[Microservice Pods, Services, Ingress, HPA]
        K8s --> Rollback[Instant 1-Click Helm Rollback Engine]
    end

    subgraph User Experience
        Gateway <--> WebUI[ShipOps Management Console]
        Streamer --> WebUI
        Gateway <--> ShipCtl[shipctl CLI Tool]
    end
```

---

## 🧱 What Was Built

### 1. Core Platform & Pipeline Engine (`src/`)
- **Multi-Stage Orchestration (`src/engine/pipeline-runner.ts`)**: Executes 6 automated stages:
  1. **Source Checkout**: Prepares workspace, fetches git commit metadata.
  2. **Test & Quality**: Executes test suites and asserts code quality.
  3. **Containerization Engine (`src/docker/docker-engine.ts`)**: Builds multi-stage Docker images, generates `sha256` digests, tags releases (`latest`, `v1.x`, `git-sha`), and performs automated vulnerability scanning (0 High/Critical CVEs policy).
  4. **Helm Manager (`src/helm/helm-manager.ts`)**: Lints chart syntax, validates OpenAPI specs, dry-runs templates, and produces `.tgz` packages.
  5. **Kubernetes Rollout (`src/k8s/k8s-client.ts`)**: Executes rolling update (`maxSurge=25%`, `maxUnavailable=0`), deploys Pods, Services, Ingress, HPAs, and monitors pod readiness.
  6. **Post-Deployment Verification**: Runs synthetic probes against `/healthz`, `/ready`, and `/metrics`.
- **Async Concurrency Job Queue (`src/engine/job-queue.ts`)**: Worker pool with concurrency limits and FIFO task scheduling.
- **Real-Time Log Streamer (`src/engine/log-streamer.ts`)**: Streams colored ANSI logs over WebSocket (`/ws/logs`) and Server-Sent Events (`/api/pipelines/:id/stream`).

### 2. Database Layer & Schema (`src/db/`)
- **PostgreSQL Schema (`src/db/schema.sql`)**: High-performance relational schema for `projects`, `pipeline_runs`, `stage_executions`, `deployments`, `helm_releases`, and `audit_logs`.
- **Dual-Mode Data Client (`src/db/database.ts`)**: Connects to PostgreSQL with automated migrations and provides zero-config persistent state caching when running standalone.

### 3. Kubernetes & Helm Management
- **Instant 1-Click Rollback**: Enables rolling back any Helm release to any previous revision with automatic revision increment, values reversion, and pod recreation.
- **Dual-Mode Cluster Engine**: Direct integration with `@kubernetes/client-node` for live clusters (`minikube`, `kind`, `k3d`, EKS, GKE) and a built-in stateful cluster simulator.

### 4. Observability & DORA Metrics (`src/metrics/`)
- **Prometheus Custom Metrics Exporter (`/metrics`)**:
  - `cicd_pipeline_runs_total{project, branch, trigger, status, environment}`
  - `cicd_pipeline_duration_seconds` (Histogram)
  - `cicd_stage_duration_seconds` (Histogram)
  - `cicd_deployments_total`
  - `cicd_deployment_duration_seconds`
  - `cicd_active_pipelines`
  - `k8s_active_replicas`
  - `helm_current_revision`
  - `cicd_rollbacks_total`
- **DORA Metrics Engine (`/api/metrics/dora`)**: Computes Deployment Frequency, Lead Time for Changes, Change Failure Rate, and MTTR.

### 5. Management Console & Modern Web UI (`public/`)
- **Interactive Pipeline DAG Stepper**: Visual stage transitions with real-time status spinners and timing.
- **Real-Time Streaming Terminal**: Live ANSI colored terminal output with auto-scrolling and log copying.
- **Deployments & Helm Hub**: Environment switcher, revision inspector, and 1-click rollback modal.
- **Kubernetes Workload Monitor**: Live pod replica cards with CPU, memory, IP, and readiness indicators.
- **Webhook & Chaos Simulator**: One-click GitHub push/PR event simulation with HMAC generation.

### 6. Sample Microservice & Production Helm Charts (`sample-apps/`, `charts/`)
- `sample-apps/order-service`: Production Node.js microservice with health probes, Prometheus metrics, and multi-stage `Dockerfile`.
- `charts/order-service`: Production Helm chart with `Deployment`, `Service`, `Ingress`, `HPA`, `ConfigMap`, `Secret`, and `ServiceAccount`.

### 7. Full-Stack Infrastructure & GitHub Actions
- `docker-compose.yml`: Spins up ShipOps Platform, PostgreSQL, Prometheus, and Grafana in one command.
- `monitoring/prometheus.yml` & `monitoring/grafana/`: Pre-provisioned Grafana datasource and dashboard (`cicd-platform.json`).
- `k8s/shipops-platform/`: Kubernetes manifests (Deployment, Service, Ingress, RBAC) for running ShipOps in a cluster.
- `.github/workflows/ci.yml` & `.github/workflows/client-deploy-example.yml`: Automated GitHub Actions workflows.
- `src/cli/shipctl.ts` & `bin/shipctl.js`: Command-line interface tool.

---

## 🧪 Validation & Automated Test Results

The platform test suite verified all 4 subsystems with **13/13 passing tests**:

```text
 ✓ tests/db.test.ts (4 tests) - PostgreSQL/Embedded CRUD, migrations & schema
 ✓ tests/helm.test.ts (2 tests) - Helm chart linting, packaging, deployment & 1-click rollback
 ✓ tests/api.test.ts (6 tests) - Health check, pipeline trigger, DORA metrics, /metrics, GitHub webhooks
 ✓ tests/pipeline.test.ts (1 test) - Full 6-stage end-to-end pipeline execution with live logs

 Test Files  4 passed (4)
      Tests  13 passed (13)
```

---

## 🚀 Quickstart

### 1. Launch with Docker Compose (Platform + PostgreSQL + Prometheus + Grafana)
```bash
docker-compose up -d
```
- **Web Console**: [http://localhost:4000](http://localhost:4000)
- **Grafana Dashboards**: [http://localhost:3001](http://localhost:3001)
- **Prometheus Metrics**: [http://localhost:9090](http://localhost:9090)
- **Raw Metrics Endpoint**: [http://localhost:4000/metrics](http://localhost:4000/metrics)

### 2. Local Node.js Execution
```bash
# Build TypeScript
npm run build

# Start Platform Server
npm start

# Or run with live reload
npm run dev
```

### 3. Interact via `shipctl` CLI
```bash
# Trigger a build and deployment to production
npm run shipctl pipeline run order-service production

# View recent pipeline runs
npm run shipctl pipeline list

# Rollback release
npm run shipctl rollback order-service-prod 1

# View DORA metrics
npm run shipctl metrics dora
```
