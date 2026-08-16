import { UserFacingError } from "./errors.js";
import { ImageGenerator } from "./generator.js";
import { resolveSurfaceTarget } from "./surface-config.js";

const DEFAULT_POLL_MS = 250;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ImageWorkerPool {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.now = dependencies.now ?? Date.now;
    this.sleep = dependencies.sleep ?? sleep;
    this.pollMs = dependencies.pollMs ?? DEFAULT_POLL_MS;
    const createGenerator = dependencies.createGenerator
      ?? ((workerConfig) => new ImageGenerator(workerConfig));
    this.workers = config.workers.map((worker) => ({
      id: worker.id,
      busy: false,
      generator: createGenerator({
        ...config,
        workers: [],
        chromeUserDataDir: worker.chromeUserDataDir,
        accountSwitchCommand: worker.accountSwitchCommand,
        profileLeaseTimeoutMs: config.poolWorkerLeaseTimeoutMs,
      }),
    }));
    this.cursor = 0;
  }

  orderedWorkers() {
    const ordered = [];
    for (let offset = 0; offset < this.workers.length; offset += 1) {
      ordered.push(this.workers[(this.cursor + offset) % this.workers.length]);
    }
    return ordered;
  }

  advanceCursor(worker) {
    const index = this.workers.indexOf(worker);
    if (index >= 0) {
      this.cursor = (index + 1) % this.workers.length;
    }
  }

  async runOnWorker(worker, operation) {
    worker.busy = true;
    try {
      return await operation(worker.generator);
    } finally {
      await worker.generator.close().catch(() => {});
      worker.busy = false;
    }
  }

  async schedule(operation) {
    const startedAt = this.now();
    while (true) {
      for (const worker of this.orderedWorkers()) {
        if (worker.busy) continue;
        try {
          const result = await this.runOnWorker(worker, operation);
          this.advanceCursor(worker);
          return result;
        } catch (error) {
          if (error?.code !== "BROWSER_PROFILE_BUSY" && error?.code !== "BROWSER_CLOSE_TIMEOUT") {
            throw error;
          }
        }
      }

      if (this.now() - startedAt >= this.config.poolWaitMs) {
        throw new UserFacingError(
          "All configured ChatGPT image browser workers are currently busy.",
          "BROWSER_POOL_BUSY",
        );
      }
      await this.sleep(this.pollMs);
    }
  }

  async generate(input) {
    const target = resolveSurfaceTarget(this.config, input);
    const pathname = new URL(target.url).pathname.replace(/\/+$/, "") || "/";
    if (pathname !== "/" && pathname !== "/images") {
      throw new UserFacingError(
        "Multi-worker generation cannot route an account-scoped ChatGPT conversation or project URL without explicit affinity.",
        "POOL_AFFINITY_REQUIRED",
      );
    }
    return this.schedule((generator) => generator.generate(input));
  }

  findWorker(workerId) {
    const worker = this.workers.find((candidate) => candidate.id === workerId);
    if (!worker) {
      throw new UserFacingError(`Unknown worker: ${workerId}`, "INVALID_WORKER");
    }
    return worker;
  }

  async check(input = {}) {
    if (input.worker) {
      const worker = this.findWorker(input.worker);
      if (worker.busy) {
        throw new UserFacingError(
          `ChatGPT image worker ${worker.id} is currently busy.`,
          "BROWSER_PROFILE_BUSY",
        );
      }
      const { worker: _worker, ...checkInput } = input;
      const result = await this.runOnWorker(worker, (generator) => generator.check(checkInput));
      return { ...result, worker: worker.id };
    }
    return this.schedule((generator) => generator.check(input));
  }

  async setupProject(input = {}) {
    if (!input.worker && this.workers.length > 1) {
      throw new UserFacingError(
        "Pool mode requires an explicit worker for project setup.",
        "WORKER_REQUIRED",
      );
    }
    const worker = this.findWorker(input.worker || this.workers[0].id);
    if (worker.busy) {
      throw new UserFacingError(
        `ChatGPT image worker ${worker.id} is currently busy.`,
        "BROWSER_PROFILE_BUSY",
      );
    }
    const { worker: _worker, ...setupInput } = input;
    const result = await this.runOnWorker(worker, (generator) => generator.setupProject(setupInput));
    return { ...result, worker: worker.id };
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.generator.close().catch(() => {})));
  }
}
