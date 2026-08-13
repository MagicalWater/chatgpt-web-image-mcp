import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_POLL_MS = 250;
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
    if (
      Number.isInteger(value?.pid) &&
      value.pid > 0 &&
      typeof value?.nonce === "string" &&
      value.nonce.length > 0
    ) {
      return { pid: value.pid, nonce: value.nonce };
    }
  } catch {
    // A peer can exist between atomic mkdir and owner metadata write. Treat
    // unreadable metadata as occupied rather than deleting an active lease.
  }
  return null;
}

async function releaseOwnedLease(lockDir, nonce) {
  const current = await readOwner(lockDir);
  if (!current || current.nonce !== nonce) return;
  await fs.rm(lockDir, { recursive: true, force: true });
}

export async function acquireBrowserProfileLease(profileDir, options = {}) {
  const lockDir = `${path.resolve(profileDir)}.chatgpt-web-image.lock`;
  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const isProcessAlive = options.isProcessAlive ?? (async (ownerPid) => processIsAlive(ownerPid));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();

  while (true) {
    try {
      await fs.mkdir(lockDir);
      try {
        await fs.writeFile(
          path.join(lockDir, OWNER_FILE),
          JSON.stringify({ pid, nonce }),
          { encoding: "utf8", flag: "wx" },
        );
      } catch (error) {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return {
        pid,
        async release() {
          await releaseOwnedLease(lockDir, nonce);
        },
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

    if (now() - startedAt >= timeoutMs) {
      throw new UserFacingError(
        "The dedicated ChatGPT browser profile is still in use by another image operation.",
        "BROWSER_PROFILE_BUSY",
      );
    }
    await sleep(pollMs);
  }
}
