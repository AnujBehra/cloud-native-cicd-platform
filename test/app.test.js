const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const request = require("supertest");
const { createApp } = require("../src/app");
const { MemoryStore } = require("../src/store");

function makeApp(overrides = {}) {
  const store = new MemoryStore();
  const app = createApp({
    store,
    config: {
      pipelineMode: "simulate",
      dockerRegistry: "ghcr.io/test",
      kubeNamespace: "apps",
      corsOrigin: "*",
      resolveCommitSha: async () => "resolved1234567890abcdef",
      ...overrides
    }
  });
  return { app, store };
}

test("creates a deployment and records pipeline events", async () => {
  const { app } = makeApp();

  const response = await request(app)
    .post("/api/deployments")
    .send({
      repository: "acme/sample-api",
      branch: "main",
      commit_sha: "8f14e45fceea167a5a36dedd4bea2543",
      environment: "staging"
    })
    .expect(202);

  assert.equal(response.body.status, "queued");
  assert.equal(response.body.image_tag, "acme-sample-api:8f14e45fceea");

  await new Promise((resolve) => setTimeout(resolve, 2300));

  const detail = await request(app).get(`/api/deployments/${response.body.id}`).expect(200);
  assert.equal(detail.body.status, "deployed");
  assert.equal(detail.body.events.filter((event) => event.status === "succeeded").length, 6);
});

test("exposes queue status", async () => {
  const { app } = makeApp();

  const response = await request(app).get("/api/queue").expect(200);

  assert.equal(response.body.concurrency, 1);
  assert.equal(response.body.active, 0);
  assert.equal(response.body.pending, 0);
});

test("resolves latest public repository commit when SHA is omitted", async () => {
  const { app } = makeApp({
    resolveCommitSha: async (repository, branch) => {
      assert.equal(repository, "AnujBehra/Portfolio");
      assert.equal(branch, "main");
      return "abcdef1234567890abcdef1234567890abcdef12";
    }
  });

  const response = await request(app)
    .post("/api/deployments")
    .send({
      repository: "https://github.com/AnujBehra/Portfolio.git",
      branch: "main",
      environment: "staging"
    })
    .expect(202);

  assert.equal(response.body.repository, "AnujBehra/Portfolio");
  assert.equal(response.body.commit_sha, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(response.body.image_tag, "anujbehra-portfolio:abcdef123456");
});

test("rejects invalid deployment requests", async () => {
  const { app } = makeApp();

  const response = await request(app)
    .post("/api/deployments")
    .send({
      repository: "",
      branch: "main",
      commit_sha: "short",
      environment: "prod"
    })
    .expect(400);

  assert.equal(response.body.error, "Invalid request");
});

test("accepts a GitHub push webhook", async () => {
  const { app } = makeApp();

  const response = await request(app)
    .post("/api/webhooks/github")
    .send({
      ref: "refs/heads/main",
      after: "1234567890abcdef",
      repository: {
        full_name: "acme/web"
      }
    })
    .expect(202);

  assert.equal(response.body.repository, "acme/web");
  assert.equal(response.body.branch, "main");
});

test("requires API key for state-changing API requests when configured", async () => {
  const { app } = makeApp({ apiKey: "test-secret" });

  await request(app)
    .post("/api/deployments")
    .send({
      repository: "acme/sample-api",
      branch: "main",
      commit_sha: "8f14e45fceea167a5a36dedd4bea2543",
      environment: "prod"
    })
    .expect(401);

  await request(app)
    .post("/api/deployments")
    .set("x-api-key", "test-secret")
    .send({
      repository: "acme/sample-api",
      branch: "main",
      commit_sha: "8f14e45fceea167a5a36dedd4bea2543",
      environment: "prod"
    })
    .expect(202);
});

test("verifies signed GitHub webhooks when a secret is configured", async () => {
  const { app } = makeApp({ githubWebhookSecret: "webhook-secret" });
  const payload = JSON.stringify({
    ref: "refs/heads/main",
    after: "1234567890abcdef",
    repository: {
      full_name: "acme/web"
    }
  });
  const signature = `sha256=${createHmac("sha256", "webhook-secret").update(payload).digest("hex")}`;

  await request(app).post("/api/webhooks/github").send(payload).set("Content-Type", "application/json").expect(401);

  await request(app)
    .post("/api/webhooks/github")
    .set("Content-Type", "application/json")
    .set("x-hub-signature-256", signature)
    .send(payload)
    .expect(202);
});
