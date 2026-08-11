class PipelineQueue {
  constructor({ runner, concurrency = 1, logger = console }) {
    this.runner = runner;
    this.concurrency = concurrency;
    this.logger = logger;
    this.pending = [];
    this.active = 0;
  }

  enqueue(deployment) {
    this.pending.push(deployment);
    this.drain();
    return {
      active: this.active,
      pending: this.pending.length
    };
  }

  stats() {
    return {
      active: this.active,
      pending: this.pending.length,
      concurrency: this.concurrency
    };
  }

  drain() {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const deployment = this.pending.shift();
      this.active += 1;
      this.runner.run(deployment)
        .catch((error) => {
          this.logger.error({ error, deploymentId: deployment.id }, "queued pipeline failed");
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

module.exports = { PipelineQueue };
