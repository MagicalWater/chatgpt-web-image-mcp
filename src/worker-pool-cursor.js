import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_POLL_MS = 20;
const OWNERLESS_STALE_MS = 5000;
const OWNER_FILE = "owner.json";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readOwner(lockDir) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(lockDir, OWNER_FILE), "utf8"));
    if (Number.isInteger(value?.pid) && value.pid > 0 && typeof value?.nonce === "string") {
      return { pid: value.pid, nonce: value.nonce };
    }
  } catch {
    // A peer can exist between mkdir and metadata write. Treat it as occupied.
  }
  return null;
}

async function acquireCursorLock(cursorFile, options = {}) {
  const lockDir = `${cursorFile}.lock`;
  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isProcessAlive = options.isProcessAlive ?? (async (ownerPid) => processIsAlive(ownerPid));
  const startedAt = now();

  while (true) {
    try {
      await fs.mkdir(lockDir, { recursive: false });
      try {
        await fs.writeFile(path.join(lockDir, OWNER_FILE), JSON.stringify({ pid, nonce }), {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return async () => {
        const owner = await readOwner(lockDir);
        if (owner?.nonce === nonce) {
          await fs.rm(lockDir, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const owner = await readOwner(lockDir);
    if (owner && !(await isProcessAlive(owner.pid))) {
      const confirmed = await readOwner(lockDir);
      if (confirmed?.pid === owner.pid && confirmed?.nonce === owner.nonce) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
    }
    if (!owner) {
      try {
        const stat = await fs.stat(lockDir);
        if (now() - stat.mtimeMs >= OWNERLESS_STALE_MS) {
          const confirmed = await readOwner(lockDir);
          if (!confirmed) {
            await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
            continue;
          }
        }
      } catch {
        // The lock can disappear between inspection steps; retry normally.
      }
    }
    if (now() - startedAt >= timeoutMs) {
      throw new Error("Timed out acquiring worker-pool cursor lock.");
    }
    await sleep(pollMs);
  }
}

async function readCursor(cursorFile, workerIds) {
  try {
    const state = JSON.parse(await fs.readFile(cursorFile, "utf8"));
    if (
      Array.isArray(state?.workerIds)
      && state.workerIds.length === workerIds.length
      && state.workerIds.every((id, index) => id === workerIds[index])
      && Number.isInteger(state?.nextIndex)
      && state.nextIndex >= 0
      && state.nextIndex < workerIds.length
    ) {
      return state.nextIndex;
    }
  } catch {
    // Missing, stale, or malformed state resets to worker zero.
  }
  return 0;
}

export async function claimWorkerStart(cursorFile, workerIds, options = {}) {
  if (!Array.isArray(workerIds) || workerIds.length < 1) {
    throw new Error("workerIds must contain at least one worker.");
  }
  const resolved = path.resolve(cursorFile);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const release = await acquireCursorLock(resolved, options);
  try {
    const startIndex = await readCursor(resolved, workerIds);
    const nextIndex = (startIndex + 1) % workerIds.length;
    const tempFile = `${resolved}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify({
      schemaVersion: 1,
      workerIds,
      nextIndex,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n", "utf8");
    await fs.rename(tempFile, resolved);
    return startIndex;
  } finally {
    await release();
  }
}
