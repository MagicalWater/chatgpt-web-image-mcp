import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ImageGenerator, runWindowsAccountSwitcher } from "../src/generator.js";
import { UserFacingError } from "../src/errors.js";

function createGenerator({ accountSwitcher, session, accountSwitchCommand = "C:\\switch.cmd" } = {}) {
  const config = {
    accountSwitchCommand,
    outputDir: "C:\\temp\\chatgpt-web-image-test",
    maxImageBytes: 1024,
  };
  return new ImageGenerator(config, {
    session:
      session ||
      ({
        async close() {},
      }),
    accountSwitcher,
    projectManager: {},
  });
}

test("quota exhaustion closes the browser, switches account, and retries once on Windows", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only account switch contract");
    return;
  }

  const calls = [];
  const generator = createGenerator({
    session: {
      async close() {
        calls.push("close");
      },
    },
    async accountSwitcher() {
      calls.push("switch");
    },
  });

  let attempts = 0;
  generator.runGenerationAttempt = async () => {
    attempts += 1;
    calls.push(`attempt:${attempts}`);
    if (attempts === 1) {
      throw new UserFacingError("quota", "IMAGE_GENERATION_QUOTA_EXHAUSTED");
    }
    return { ok: true };
  };

  const result = await generator.runGeneration({ prompt: "test" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["attempt:1", "close", "switch", "attempt:2"]);
});

test("quota exhaustion does not switch or retry when no account switch command is configured", async () => {
  let switches = 0;
  let attempts = 0;
  const generator = createGenerator({
    accountSwitchCommand: "",
    async accountSwitcher() {
      switches += 1;
    },
  });
  generator.runGenerationAttempt = async () => {
    attempts += 1;
    throw new UserFacingError("quota", "IMAGE_GENERATION_QUOTA_EXHAUSTED");
  };

  await assert.rejects(
    () => generator.runGeneration({ prompt: "test" }),
    (error) => error?.code === "IMAGE_GENERATION_QUOTA_EXHAUSTED",
  );
  assert.equal(attempts, 1);
  assert.equal(switches, 0);
});

test("second quota exhaustion is returned without another account switch", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only account switch contract");
    return;
  }

  let switches = 0;
  let attempts = 0;
  const generator = createGenerator({
    async accountSwitcher() {
      switches += 1;
    },
  });
  generator.runGenerationAttempt = async () => {
    attempts += 1;
    throw new UserFacingError("quota", "IMAGE_GENERATION_QUOTA_EXHAUSTED");
  };

  await assert.rejects(
    () => generator.runGeneration({ prompt: "test" }),
    (error) => error?.code === "IMAGE_GENERATION_QUOTA_EXHAUSTED",
  );
  assert.equal(attempts, 2);
  assert.equal(switches, 1);
});

test("non-quota failures do not switch account", async () => {
  let switches = 0;
  const generator = createGenerator({
    async accountSwitcher() {
      switches += 1;
    },
  });
  generator.runGenerationAttempt = async () => {
    throw new UserFacingError("other", "IMAGE_GENERATION_TIMEOUT");
  };

  await assert.rejects(
    () => generator.runGeneration({ prompt: "test" }),
    (error) => error?.code === "IMAGE_GENERATION_TIMEOUT",
  );
  assert.equal(switches, 0);
});

test("Windows account switch command supports spaces and waits for the cmd script exit code", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only cmd contract");
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-account-switch-test-"));
  const dir = path.join(root, "path with spaces");
  await fs.mkdir(dir);
  const success = path.join(dir, "success.cmd");
  const failure = path.join(dir, "failure.cmd");
  await fs.writeFile(success, "@echo off\r\nexit /b 0\r\n");
  await fs.writeFile(failure, "@echo off\r\nexit /b 7\r\n");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await runWindowsAccountSwitcher(success);
  await assert.rejects(() => runWindowsAccountSwitcher(failure), /code=7/);
});
