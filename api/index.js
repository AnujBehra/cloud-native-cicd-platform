const { createApp } = require("../src/app");
const { MemoryStore } = require("../src/store");

const store = new MemoryStore();

const app = createApp({
  store,
  config: {
    nodeEnv: "production",
    pipelineMode: "simulate",
    dockerRegistry: "vercel-demo",
    pushImages: false,
    securityScanEnabled: false,
    securityScanFailOnFindings: false,
    pipelineConcurrency: 1,
    runPipelinesInline: true,
    kubeNamespace: "vercel-demo",
    helmReleasePrefix: "app",
    gitAuthToken: process.env.GIT_AUTH_TOKEN || "",
    kubeconfig: "",
    kubeContext: "",
    appChartPath: "./helm/deployed-app",
    apiKey: process.env.API_KEY || "",
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET || "",
    corsOrigin: "*",
    logLevel: process.env.LOG_LEVEL || "info"
  }
});

module.exports = app;
