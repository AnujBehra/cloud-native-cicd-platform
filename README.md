# Cloud-Native CI/CD Deployment Platform

Production-style portfolio platform where users submit a public GitHub repository, the system clones the source, resolves the target commit, runs detected checks, builds Docker images, deploys workloads to Kubernetes with Helm, and exposes deployment status through REST APIs plus Prometheus/Grafana monitoring.

## What It Includes

- Node.js REST API and polished deployment control-plane dashboard
- PostgreSQL deployment and pipeline event history
- Real CI/CD runner that clones GitHub repositories, detects Node/static/supported Compose apps, builds Docker images, and deploys with Helm
- Multi-service Compose deployment support with isolated Kubernetes namespaces per application
- In-process pipeline queue with configurable concurrency
- Raw per-stage logs for build, security scan, and Kubernetes rollout stages
- Trivy-based container image scanning for HIGH/CRITICAL vulnerabilities
- Helm rollback API and dashboard action for deployed releases
- Registry-ready image push flow for GHCR, Docker Hub, or another pullable registry
- Public and private GitHub repository support through an optional GitHub token
- Simulated CI/CD runner available with `PIPELINE_MODE=simulate` for offline development
- API-key protection for state-changing API calls and optional signed GitHub webhook verification
- Dockerfile and Docker Compose stack
- Helm chart for the CI/CD platform, a generic single-app chart, and a Compose-to-Kubernetes chart
- GitHub Actions workflow template that notifies the platform on every push
- Prometheus `/metrics` endpoint and provisioned Grafana dashboard
- Real public-repository deployment flow with automatic latest-commit resolution

## Architecture

```mermaid
flowchart LR
  User["Dashboard / API / GitHub Actions"] --> API["Node.js API"]
  API --> DB["PostgreSQL"]
  API --> Runner["Pipeline Runner"]
  Runner --> GitHub["Public GitHub Repo"]
  Runner --> Docker["Docker Build"]
  Runner --> Helm["Helm Release"]
  Helm --> K8s["Docker Desktop Kubernetes"]
  API --> Prom["Prometheus Metrics"]
  Prom --> Grafana["Grafana Dashboard"]
```

## Run Locally

```bash
npm install
npm test
docker compose up --build
```

The Compose stack runs in real mode by default. It uses Docker Desktop Kubernetes, the host Docker socket, and your local kubeconfig so it can build images and deploy them into a real local Kubernetes cluster.

There is no sample-data seeder in the production-style Compose stack. Deployment history comes from real repositories triggered through the dashboard, API, webhook, or GitHub Actions workflow.

Open:

- App: http://localhost:3003
- Prometheus: http://localhost:9091
- Grafana: http://localhost:3004

Grafana login is `admin` / `admin`.
The local API key for dashboard-triggered deployments is `local-dev-secret`.

## Production Controls

Key runtime switches:

```bash
PIPELINE_MODE=real
PIPELINE_CONCURRENCY=1
SECURITY_SCAN_ENABLED=true
SECURITY_SCAN_FAIL_ON_FINDINGS=false
DOCKER_REGISTRY=local
PUSH_IMAGES=false
GIT_AUTH_TOKEN=
```

For local Docker Desktop Kubernetes, keep `DOCKER_REGISTRY=local` and `PUSH_IMAGES=false`. For a remote Kubernetes cluster, set `PUSH_IMAGES=true`, set `DOCKER_REGISTRY` to a registry your cluster can pull from, authenticate Docker before starting the platform, and point `KUBECONFIG`/`KUBE_CONTEXT` at the target cluster.

For GHCR:

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u your-github-username --password-stdin
```

For private GitHub repositories, set `GIT_AUTH_TOKEN` to a GitHub token with repository read access. The token is used for GitHub API commit resolution and `git clone`.

## Real Deployment Flow

1. Enable Kubernetes in Docker Desktop.
2. Make sure your current Kubernetes context is Docker Desktop:

```bash
kubectl config current-context
kubectl get nodes
```

3. Start the platform:

```bash
docker compose up --build
```

4. Trigger a real deployment from the dashboard. Choose a real public repo preset or enter any public GitHub repository with a `Dockerfile`, `package.json`, root `index.html`, or supported `docker-compose.yml`.

You can also trigger from the API. If `commit_sha` is omitted, the platform resolves the latest commit from GitHub:

```bash
curl -X POST http://localhost:3003/api/deployments \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-secret" \
  -d '{
    "repository": "AnujBehra/Portfolio",
    "branch": "main",
    "environment": "staging"
  }'
```

5. Watch the deployment:

```bash
kubectl -n apps get deployments,services,pods
```

6. Open a single-service deployed app through a Kubernetes port-forward:

```bash
kubectl -n apps port-forward svc/app-anujbehra-portfolio-staging-deployed-app 8088:80
```

Then open http://localhost:8088.

For the multi-service sample application:

```bash
kubectl -n apps-anujbehra-multiservice-docker-platform-st port-forward svc/web 8090:80
```

Then open http://localhost:8090.

For Docker Desktop local deployments, `PUSH_IMAGES=false` keeps images in the local Docker image store and Helm uses `imagePullPolicy=Never`.

## API

Trigger a deployment:

```bash
curl -X POST http://localhost:3003/api/deployments \
  -H "Content-Type: application/json" \
  -H "x-api-key: local-dev-secret" \
  -d '{
    "repository": "AnujBehra/Portfolio",
    "branch": "main",
    "environment": "staging"
  }'
```

Use a full commit SHA only when you want to pin an exact revision:

```json
{
  "repository": "AnujBehra/Portfolio",
  "branch": "main",
  "commit_sha": "da91774b3762a595ef4d9cda0720f7393905b89a",
  "environment": "staging"
}
```

The runner supports repositories with:

- a `Dockerfile`
- a Node.js `package.json`
- a static `index.html`
- a `docker-compose.yml` with buildable services and supported backing services such as PostgreSQL and Redis

For supported Compose-style repositories, the platform builds each service image and deploys multiple Kubernetes Deployments/Services through `helm/compose-app`. Each Compose application gets an isolated namespace to avoid service-name collisions. For example, `AnujBehra/Multiservice-docker-Platform` deploys `web`, `api`, `db`, and `redis` into `apps-anujbehra-multiservice-docker-platform-st`.

## Verified Real Deployment

This project was verified against a real public repository:

- Repository: `AnujBehra/Multiservice-docker-Platform`
- Commit: `38acff84130652a03a697dc6a2528fada3829384`
- Pipeline: clone, nested `api` test, Docker builds for `web` and `api`, Trivy image scan, Helm deploy
- Operations: Helm rollback verified through the platform API
- Kubernetes namespace: `apps-anujbehra-multiservice-docker-platform-st`
- Services: `web`, `api`, `db`, `redis`

Smoke-test commands:

```bash
kubectl -n apps-anujbehra-multiservice-docker-platform-st get deployments,services,pods
kubectl -n apps-anujbehra-multiservice-docker-platform-st port-forward svc/web 8090:80
curl http://localhost:8090/health
curl http://localhost:8090/api/stats
```

List deployments:

```bash
curl http://localhost:3003/api/deployments
```

Inspect a deployment and its pipeline events:

```bash
curl http://localhost:3003/api/deployments/<deployment-id>
```

Check queue status:

```bash
curl http://localhost:3003/api/queue
```

Rollback a Helm release:

```bash
curl -X POST http://localhost:3003/api/deployments/<deployment-id>/rollback \
  -H "x-api-key: local-dev-secret"
```

GitHub webhook endpoint:

```bash
curl -X POST http://localhost:3003/api/webhooks/github \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=<hmac-of-raw-body>" \
  -d '{
    "ref": "refs/heads/main",
    "after": "8f14e45fceea167a5a36dedd4bea2543",
    "repository": { "full_name": "AnujBehra/Portfolio" }
  }'
```

For the Docker Compose stack, the webhook signing secret is `local-webhook-secret`.

## GitHub Actions Trigger

Add this workflow to any application repo at `.github/workflows/deploy-to-platform.yml`.

```yaml
name: Deploy Through CI/CD Platform

on:
  push:
    branches:
      - main

jobs:
  notify-platform:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Notify CI/CD Platform
        run: |
          curl -f -X POST "${{ secrets.CICD_PLATFORM_URL }}/api/deployments" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${{ secrets.CICD_PLATFORM_API_KEY }}" \
            -d '{
              "repository": "${{ github.repository }}",
              "branch": "${{ github.ref_name }}",
              "commit_sha": "${{ github.sha }}",
              "environment": "staging"
            }'
```

Set these repository secrets in GitHub:

- `CICD_PLATFORM_URL`: your ngrok URL, for example `https://theorize-stoplight-womb.ngrok-free.dev`
- `CICD_PLATFORM_API_KEY`: `local-dev-secret`

Do not add `npm install` or `npm test` to this workflow unless your application repo actually has a `package.json`. The platform itself performs detected checks after it clones the repo.

## Kubernetes Deployment

Create the database URL secret first:

```bash
kubectl create namespace apps
kubectl -n apps create secret generic cicd-platform-db \
  --from-literal=DATABASE_URL='postgres://user:password@postgres:5432/cicd'
kubectl -n apps create secret generic cicd-platform-api \
  --from-literal=API_KEY='replace-with-a-long-random-value'
```

Deploy:

```bash
helm upgrade --install cicd-platform ./helm/cicd-platform \
  --namespace apps \
  --set image.repository=ghcr.io/your-org/cloud-native-cicd-platform \
  --set image.tag=latest
```

## Vercel Deployment

Vercel can host the dashboard and REST API as a public project showcase. The Vercel build runs in `simulate` mode with in-memory storage because Vercel serverless functions do not provide Docker socket access, persistent background workers, or kubeconfig access. Use the Docker Compose/Kubernetes setup above for the full real pipeline that clones, builds, scans, and deploys workloads to Kubernetes.

Deploy the showcase API/dashboard:

```bash
vercel deploy --prod
```

Optional Vercel environment variables:

```bash
API_KEY=<long-random-value>
GIT_AUTH_TOKEN=<token-for-private-repos-if-needed>
GITHUB_WEBHOOK_SECRET=<github-webhook-secret-if-needed>
```

Smoke test the Vercel deployment:

```bash
curl https://your-vercel-url/readyz
curl -X POST https://your-vercel-url/api/deployments \
  -H "Content-Type: application/json" \
  -H "x-api-key: <API_KEY-if-configured>" \
  -d '{
    "repository": "AnujBehra/Multiservice-docker-Platform",
    "branch": "main",
    "environment": "staging"
  }'
```

## Resume Bullet

Built a production-style cloud-native CI/CD deployment platform that queues real GitHub repository deployments, runs automated checks and Trivy image scans, builds single-service and Compose-based Docker images, optionally pushes to a registry, deploys workloads to Kubernetes with Helm, supports rollback, and exposes real-time status/logs through REST APIs plus Prometheus/Grafana monitoring.
