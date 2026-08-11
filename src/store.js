const { Pool } = require("pg");

class MemoryStore {
  constructor() {
    this.deployments = new Map();
    this.events = [];
  }

  async createDeployment(input) {
    const deployment = {
      ...input,
      status: "queued",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deployed_at: null
    };
    this.deployments.set(deployment.id, deployment);
    return deployment;
  }

  async updateDeployment(id, patch) {
    const existing = this.deployments.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
    this.deployments.set(id, next);
    return next;
  }

  async addEvent(deploymentId, stage, status, message, logs = "") {
    const event = {
      id: this.events.length + 1,
      deployment_id: deploymentId,
      stage,
      status,
      message,
      logs,
      created_at: new Date().toISOString()
    };
    this.events.push(event);
    return event;
  }

  async listDeployments() {
    return [...this.deployments.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getDeployment(id) {
    return this.deployments.get(id) || null;
  }

  async listEvents(deploymentId) {
    return this.events.filter((event) => event.deployment_id === deploymentId);
  }

  async healthCheck() {
    return true;
  }

  async close() {
    return true;
  }
}

class PgStore {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }

  async createDeployment(input) {
    const result = await this.pool.query(
      `insert into deployments
       (id, repository, branch, commit_sha, image_tag, environment, status)
       values ($1, $2, $3, $4, $5, $6, 'queued')
       returning *`,
      [input.id, input.repository, input.branch, input.commit_sha, input.image_tag, input.environment]
    );
    return result.rows[0];
  }

  async updateDeployment(id, patch) {
    const keys = Object.keys(patch);
    if (keys.length === 0) return this.getDeployment(id);
    const sets = keys.map((key, index) => `${key} = $${index + 2}`);
    const result = await this.pool.query(
      `update deployments set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
      [id, ...keys.map((key) => patch[key])]
    );
    return result.rows[0] || null;
  }

  async addEvent(deploymentId, stage, status, message, logs = "") {
    const result = await this.pool.query(
      `insert into deployment_events (deployment_id, stage, status, message, logs)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [deploymentId, stage, status, message, logs]
    );
    return result.rows[0];
  }

  async listDeployments() {
    const result = await this.pool.query("select * from deployments order by created_at desc limit 100");
    return result.rows;
  }

  async getDeployment(id) {
    const result = await this.pool.query("select * from deployments where id = $1", [id]);
    return result.rows[0] || null;
  }

  async listEvents(deploymentId) {
    const result = await this.pool.query(
      "select * from deployment_events where deployment_id = $1 order by created_at asc",
      [deploymentId]
    );
    return result.rows;
  }

  async healthCheck() {
    await this.pool.query("select 1");
    return true;
  }

  async close() {
    await this.pool.end();
  }
}

function createStore(databaseUrl) {
  return databaseUrl ? new PgStore(databaseUrl) : new MemoryStore();
}

module.exports = { MemoryStore, PgStore, createStore };
