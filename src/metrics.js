const client = require("prom-client");

client.collectDefaultMetrics();

const deploymentsTotal = new client.Counter({
  name: "cicd_deployments_total",
  help: "Total deployments by final status",
  labelNames: ["status", "environment"]
});

const pipelineDuration = new client.Histogram({
  name: "cicd_pipeline_duration_seconds",
  help: "Pipeline duration in seconds",
  labelNames: ["status", "environment"],
  buckets: [1, 2, 5, 10, 30, 60, 120, 300]
});

const activePipelines = new client.Gauge({
  name: "cicd_active_pipelines",
  help: "Number of pipelines currently running"
});

module.exports = {
  client,
  deploymentsTotal,
  pipelineDuration,
  activePipelines
};
