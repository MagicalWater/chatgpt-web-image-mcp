import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ImageGenerator, runAccountSwitcher } from "../src/generator.js";
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

test("quota exhaustion closes the browser, switches account, and retries once on supported platforms", async (t) => {
  if (!["win32", "darwin"].includes(process.platform)) {
    t.skip("account switch retry is supported only on Windows and macOS");
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
  if (!["win32", "darwin"].includes(process.platform)) {
    t.skip("account switch retry is supported only on Windows and macOS");
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
  let closes = 0;
  const generator = createGenerator({
    session: {
      async close() {
        closes += 1;
      },
    },
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
  assert.equal(closes, 1);
});

test("cleanup failure does not replace the original terminal generation error", async () => {
  const generator = createGenerator({
    session: {
      async close() {
        throw new Error("sensitive cleanup detail");
      },
    },
  });
  generator.runGenerationAttempt = async () => {
    throw new UserFacingError("timed out", "IMAGE_GENERATION_TIMEOUT");
  };

  await assert.rejects(
    () => generator.runGeneration({ prompt: "test" }),
    (error) => {
      assert.equal(error.code, "IMAGE_GENERATION_TIMEOUT");
      assert.equal(error.message, "timed out");
      return true;
    },
  );
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

  await runAccountSwitcher(success, "win32");
  await assert.rejects(() => runAccountSwitcher(failure, "win32"), /code=7/);
});

test("macOS account switch command supports spaces and waits for the command exit code", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS-only command contract");
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-account-switch-test-"));
  const dir = path.join(root, "path with spaces");
  await fs.mkdir(dir);
  const success = path.join(dir, "success.command");
  const failure = path.join(dir, "failure.command");
  await fs.writeFile(success, "#!/bin/zsh\nexit 0\n");
  await fs.writeFile(failure, "#!/bin/zsh\nexit 7\n");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await runAccountSwitcher(success, "darwin");
  await assert.rejects(() => runAccountSwitcher(failure, "darwin"), /code=7/);
});
