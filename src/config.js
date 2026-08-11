require("dotenv").config();
const { z } = require("zod");

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }
  return value;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional().default(""),
  PIPELINE_MODE: z.enum(["simulate", "real"]).default("simulate"),
  DOCKER_REGISTRY: z.string().min(1).default("local"),
  PUSH_IMAGES: booleanFromEnv.default(false),
  SECURITY_SCAN_ENABLED: booleanFromEnv.default(true),
  SECURITY_SCAN_FAIL_ON_FINDINGS: booleanFromEnv.default(false),
  PIPELINE_CONCURRENCY: z.coerce.number().int().positive().default(1),
  RUN_PIPELINES_INLINE: booleanFromEnv.default(false),
  KUBE_NAMESPACE: z.string().min(1).default("apps"),
  HELM_RELEASE_PREFIX: z.string().min(1).default("app"),
  GIT_AUTH_TOKEN: z.string().optional().default(""),
  KUBECONFIG: z.string().optional().default(""),
  KUBE_CONTEXT: z.string().optional().default(""),
  APP_CHART_PATH: z.string().default("./helm/deployed-app"),
  API_KEY: z.string().optional().default(""),
  GITHUB_WEBHOOK_SECRET: z.string().optional().default(""),
  CORS_ORIGIN: z.string().default("*"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

const env = schema.parse(process.env);

if (env.NODE_ENV === "production" && !env.API_KEY) {
  throw new Error("API_KEY is required when NODE_ENV=production");
}

const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  pipelineMode: env.PIPELINE_MODE,
  dockerRegistry: env.DOCKER_REGISTRY,
  pushImages: env.PUSH_IMAGES,
  securityScanEnabled: env.SECURITY_SCAN_ENABLED,
  securityScanFailOnFindings: env.SECURITY_SCAN_FAIL_ON_FINDINGS,
  pipelineConcurrency: env.PIPELINE_CONCURRENCY,
  runPipelinesInline: env.RUN_PIPELINES_INLINE,
  kubeNamespace: env.KUBE_NAMESPACE,
  helmReleasePrefix: env.HELM_RELEASE_PREFIX,
  gitAuthToken: env.GIT_AUTH_TOKEN,
  kubeconfig: env.KUBECONFIG,
  kubeContext: env.KUBE_CONTEXT,
  appChartPath: env.APP_CHART_PATH,
  apiKey: env.API_KEY,
  githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET,
  corsOrigin: env.CORS_ORIGIN,
  logLevel: env.LOG_LEVEL
};

module.exports = { config };
