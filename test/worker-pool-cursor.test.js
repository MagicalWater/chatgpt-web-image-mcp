import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { claimWorkerStart } from "../src/worker-pool-cursor.js";

async function withTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "image-worker-cursor-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("cross-process cursor claims workers in round-robin order", async (t) => {
  const dir = await withTempDir(t);
  const cursor = path.join(dir, "cursor.json");
  const workers = ["worker-a", "worker-b", "worker-c"];
  assert.equal(await claimWorkerStart(cursor, workers), 0);
  assert.equal(await claimWorkerStart(cursor, workers), 1);
  assert.equal(await claimWorkerStart(cursor, workers), 2);
  assert.equal(await claimWorkerStart(cursor, workers), 0);
});

test("concurrent cursor claims reserve distinct starts", async (t) => {
  const dir = await withTempDir(t);
  const cursor = path.join(dir, "cursor.json");
  const workers = ["worker-a", "worker-b", "worker-c"];
  const claims = await Promise.all([
    claimWorkerStart(cursor, workers),
    claimWorkerStart(cursor, workers),
    claimWorkerStart(cursor, workers),
  ]);
  assert.deepEqual([...claims].sort(), [0, 1, 2]);
});

test("cursor resets safely when the configured worker identity changes", async (t) => {
  const dir = await withTempDir(t);
  const cursor = path.join(dir, "cursor.json");
  assert.equal(await claimWorkerStart(cursor, ["worker-a", "worker-b"]), 0);
  assert.equal(await claimWorkerStart(cursor, ["worker-a", "worker-b"]), 1);
  assert.equal(await claimWorkerStart(cursor, ["worker-a", "worker-b", "worker-c"]), 0);
});

test("cursor reclaims an old ownerless lock but not a fresh one", async (t) => {
  const dir = await withTempDir(t);
  const cursor = path.join(dir, "cursor.json");
  const lock = `${cursor}.lock`;
  await fs.mkdir(lock);
  const old = new Date(Date.now() - 10_000);
  await fs.utimes(lock, old, old);
  assert.equal(
    await claimWorkerStart(cursor, ["worker-a", "worker-b", "worker-c"]),
    0,
  );

  await fs.rm(cursor, { force: true });
  await fs.mkdir(lock);
  let now = 0;
  await assert.rejects(
    () => claimWorkerStart(cursor, ["worker-a", "worker-b", "worker-c"], {
      timeoutMs: 20,
      pollMs: 10,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    /Timed out acquiring worker-pool cursor lock/,
  );
});
