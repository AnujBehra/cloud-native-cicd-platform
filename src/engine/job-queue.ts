import { PipelineRunner, RunPipelineOptions } from './pipeline-runner.js';
import { PipelineRun } from '../types/index.js';

export class JobQueue {
  private static instance: JobQueue;
  private runner = PipelineRunner.getInstance();
  private queue: PipelineRun[] = [];
  private isProcessing = false;
  private maxConcurrency = 3;
  private activeCount = 0;

  private constructor() {}

  public static getInstance(): JobQueue {
    if (!JobQueue.instance) {
      JobQueue.instance = new JobQueue();
    }
    return JobQueue.instance;
  }

  public async enqueue(options: RunPipelineOptions): Promise<PipelineRun> {
    const pipelineRun = await this.runner.createPipelineRun(options);
    this.queue.push(pipelineRun);
    this.processNext();
    return pipelineRun;
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrency) {
      return;
    }

    const nextRun = this.queue.shift();
    if (!nextRun) return;

    this.activeCount++;
    // Execute asynchronously without blocking queue submission
    (async () => {
      try {
        await this.runner.executePipeline(nextRun);
      } catch (err) {
        console.error('Error during queued pipeline execution:', err);
      } finally {
        this.activeCount--;
        this.processNext();
      }
    })();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }
}
