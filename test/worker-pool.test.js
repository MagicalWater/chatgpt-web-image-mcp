import assert from "node:assert/strict";
import test from "node:test";

import { UserFacingError } from "../src/errors.js";
import { ImageWorkerPool } from "../src/worker-pool.js";

function poolConfig(overrides = {}) {
  return {
    workers: [
      { id: "worker-a", chromeUserDataDir: "/tmp/a", accountSwitchCommand: "/tmp/a.command" },
      { id: "worker-b", chromeUserDataDir: "/tmp/b", accountSwitchCommand: "/tmp/b.command" },
    ],
    poolWaitMs: 1000,
    poolWorkerLeaseTimeoutMs: 100,
    poolCursorFile: "/tmp/test-worker-pool-cursor.json",
    ...overrides,
  };
}

test("two generation jobs run concurrently on different workers", async () => {
  const starts = [];
  const releases = [];
  const gates = new Map();
  const pool = new ImageWorkerPool(poolConfig(), {
    claimWorkerStart: async () => 0,
    createGenerator(config) {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      gates.set(config.chromeUserDataDir, release);
      return {
        async generate(input) {
          starts.push({ profile: config.chromeUserDataDir, prompt: input.prompt });
          await gate;
          return { ok: true, profile: config.chromeUserDataDir };
        },
        async close() {
          releases.push(config.chromeUserDataDir);
        },
      };
    },
  });

  const first = pool.generate({ prompt: "first" });
  const second = pool.generate({ prompt: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].profile, starts[1].profile);
  for (const release of gates.values()) release();
  await Promise.all([first, second]);
  assert.equal(releases.length, 2);
});

test("a profile-busy worker is skipped in favor of the next worker", async () => {
  const attempts = [];
  const pool = new ImageWorkerPool(poolConfig(), {
    claimWorkerStart: async () => 0,
    createGenerator(config) {
      return {
        async generate() {
          attempts.push(config.chromeUserDataDir);
          if (config.chromeUserDataDir === "/tmp/a") {
            throw new UserFacingError("busy", "BROWSER_PROFILE_BUSY");
          }
          return { ok: true, profile: config.chromeUserDataDir };
        },
        async close() {},
      };
    },
  });
  const result = await pool.generate({ prompt: "test" });
  assert.equal(result.profile, "/tmp/b");
  assert.deepEqual(attempts, ["/tmp/a", "/tmp/b"]);
});

test("a cleanup-blocked worker is skipped in favor of the next worker", async () => {
  const attempts = [];
  const pool = new ImageWorkerPool(poolConfig(), {
    claimWorkerStart: async () => 0,
    createGenerator(config) {
      return {
        async generate() {
          attempts.push(config.chromeUserDataDir);
          if (config.chromeUserDataDir === "/tmp/a") {
            throw new UserFacingError("cleanup blocked", "BROWSER_CLOSE_TIMEOUT");
          }
          return { ok: true, profile: config.chromeUserDataDir };
        },
        async close() {},
      };
    },
  });
  const result = await pool.generate({ prompt: "test" });
  assert.equal(result.profile, "/tmp/b");
  assert.deepEqual(attempts, ["/tmp/a", "/tmp/b"]);
});

test("pool saturation returns BROWSER_POOL_BUSY after the bounded wait", async () => {
  let now = 0;
  const pool = new ImageWorkerPool(poolConfig({ poolWaitMs: 20 }), {
    claimWorkerStart: async () => 0,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    pollMs: 10,
    createGenerator() {
      return {
        async generate() {
          throw new UserFacingError("busy", "BROWSER_PROFILE_BUSY");
        },
        async close() {},
      };
    },
  });
  await assert.rejects(
    () => pool.generate({ prompt: "test" }),
    (error) => error?.code === "BROWSER_POOL_BUSY",
  );
});

test("worker cleanup runs after success and after terminal failure", async () => {
  let closes = 0;
  let calls = 0;
  const pool = new ImageWorkerPool(poolConfig({ workers: [poolConfig().workers[0]] }), {
    claimWorkerStart: async () => 0,
    createGenerator() {
      return {
        async generate() {
          calls += 1;
          if (calls === 2) throw new UserFacingError("timeout", "IMAGE_GENERATION_TIMEOUT");
          return { ok: true };
        },
        async close() { closes += 1; },
      };
    },
  });
  await pool.generate({ prompt: "success" });
  await assert.rejects(() => pool.generate({ prompt: "failure" }), /timeout/);
  assert.equal(closes, 2);
});

test("multi-worker project setup requires an explicit worker", async () => {
  const pool = new ImageWorkerPool(poolConfig(), {
    claimWorkerStart: async () => 0,
    createGenerator() {
      return { async setupProject() { return { ok: true }; }, async close() {} };
    },
  });
  await assert.rejects(
    () => pool.setupProject({ project_name: "test" }),
    (error) => error?.code === "WORKER_REQUIRED",
  );
});

test("explicit worker diagnostics fail promptly while that worker is locally busy", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const startedGate = new Promise((resolve) => { started = resolve; });
  const pool = new ImageWorkerPool(poolConfig(), {
    claimWorkerStart: async () => 0,
    createGenerator() {
      return {
        async generate() { started(); await gate; return { ok: true }; },
        async check() { return { ready: true }; },
        async close() {},
      };
    },
  });
  const generation = pool.generate({ prompt: "hold worker-a" });
  await startedGate;
  await assert.rejects(
    () => pool.check({ worker: "worker-a" }),
    (error) => error?.code === "BROWSER_PROFILE_BUSY",
  );
  release();
  await generation;
});

test("pool generation rejects account-scoped ChatGPT URLs without affinity", async () => {
  const pool = new ImageWorkerPool(poolConfig({
    surface: "images",
    chatgptUrl: "https://chatgpt.com/images/",
    projectUrl: "",
  }), {
    claimWorkerStart: async () => 0,
    createGenerator() {
      return { async generate() { return { ok: true }; }, async close() {} };
    },
  });
  await assert.rejects(
    () => pool.generate({ prompt: "x", chatgpt_url: "https://chatgpt.com/c/abc" }),
    (error) => error?.code === "POOL_AFFINITY_REQUIRED",
  );
  await assert.rejects(
    () => pool.generate({ prompt: "x", chatgpt_url: "https://chatgpt.com/g/g-p-abc/project" }),
    (error) => error?.code === "POOL_AFFINITY_REQUIRED",
  );
});

test("scheduled checks expose the selected worker for production routing acceptance", async () => {
  const starts = [0, 1, 2, 0];
  let claim = 0;
  const workers = [
    { id: "worker-a", chromeUserDataDir: "/tmp/a", accountSwitchCommand: "/tmp/a.command" },
    { id: "worker-b", chromeUserDataDir: "/tmp/b", accountSwitchCommand: "/tmp/b.command" },
    { id: "worker-c", chromeUserDataDir: "/tmp/c", accountSwitchCommand: "/tmp/c.command" },
  ];
  const pool = new ImageWorkerPool(poolConfig({ workers }), {
    claimWorkerStart: async () => starts[claim++],
    createGenerator(config) {
      return {
        async check() { return { ready: true, profile: config.chromeUserDataDir }; },
        async close() {},
      };
    },
  });

  assert.equal((await pool.check()).worker, "worker-a");
  assert.equal((await pool.check()).worker, "worker-b");
  assert.equal((await pool.check()).worker, "worker-c");
  assert.equal((await pool.check()).worker, "worker-a");
});
