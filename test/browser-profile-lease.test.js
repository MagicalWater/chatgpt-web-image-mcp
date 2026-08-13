import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireBrowserProfileLease } from "../src/browser-profile-lease.js";

async function tempProfile(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-profile-lease-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, "chrome-profile");
}

test("profile lease is exclusive and transfers after release", async (t) => {
  const profile = await tempProfile(t);
  let now = 0;
  const first = await acquireBrowserProfileLease(profile, {
    pid: 101,
    isProcessAlive: async (pid) => pid === 101,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });

  let firstAlive = true;
  const secondPromise = acquireBrowserProfileLease(profile, {
    pid: 202,
    timeoutMs: 50,
    pollMs: 5,
    isProcessAlive: async (pid) => pid === 101 ? firstAlive : pid === 202,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
      if (now >= 5 && firstAlive) {
        firstAlive = false;
        await first.release();
      }
    },
  });
  const second = await secondPromise;
  assert.equal(second.pid, 202);
  await second.release();
});

test("profile lease reclaims a dead stale owner", async (t) => {
  const profile = await tempProfile(t);
  const lockDir = `${profile}.chatgpt-web-image.lock`;
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 303, nonce: "stale" }));

  const lease = await acquireBrowserProfileLease(profile, {
    pid: 404,
    isProcessAlive: async () => false,
  });
  assert.equal(lease.pid, 404);
  await lease.release();
});

test("profile lease times out instead of taking over a live owner", async (t) => {
  const profile = await tempProfile(t);
  const lockDir = `${profile}.chatgpt-web-image.lock`;
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 505, nonce: "live" }));
  let now = 0;

  await assert.rejects(
    acquireBrowserProfileLease(profile, {
      pid: 606,
      timeoutMs: 10,
      pollMs: 5,
      isProcessAlive: async () => true,
      now: () => now,
      sleep: async (ms) => { now += ms; },
    }),
    (error) => error?.code === "BROWSER_PROFILE_BUSY",
  );

  const owner = JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8"));
  assert.equal(owner.nonce, "live");
});

test("profile lease release cannot remove a replacement owner's lease", async (t) => {
  const profile = await tempProfile(t);
  const lease = await acquireBrowserProfileLease(profile, {
    pid: 707,
    isProcessAlive: async () => true,
  });
  const ownerPath = path.join(`${profile}.chatgpt-web-image.lock`, "owner.json");
  await fs.writeFile(ownerPath, JSON.stringify({ pid: 808, nonce: "replacement" }));
  await lease.release();
  const owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
  assert.equal(owner.nonce, "replacement");
});
