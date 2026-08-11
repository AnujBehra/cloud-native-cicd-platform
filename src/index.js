const { config } = require("./config");
const { createApp } = require("./app");
const { createStore } = require("./store");
const { logger } = require("./logger");

const store = createStore(config.databaseUrl);
const app = createApp({ store, config });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, `CI/CD platform listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await store.close();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error("forced shutdown");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
