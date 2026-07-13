import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig, validateCdpUrl, validateChatGPTUrl } from "../src/config.js";

test("loads safe defaults under the operator home", () => {
  const config = loadConfig({}, { homeDir: "/tmp/operator" });
  assert.equal(config.chatgptUrl, "https://chatgpt.com/");
  assert.equal(config.chromeUserDataDir, "/tmp/operator/.chatgpt-web-image-mcp/chrome-profile");
  assert.deepEqual(config.allowedInputDirs, []);
});

test("accepts ChatGPT project URLs and rejects arbitrary hosts", () => {
  assert.equal(
    validateChatGPTUrl("https://chatgpt.com/g/example/project"),
    "https://chatgpt.com/g/example/project",
  );
  assert.throws(() => validateChatGPTUrl("https://example.com/"), /chatgpt\.com/);
  assert.throws(() => validateChatGPTUrl("http://chatgpt.com/"), /HTTPS/);
});

test("restricts CDP to loopback unless explicitly enabled", () => {
  assert.equal(validateCdpUrl("http://127.0.0.1:9222"), "http://127.0.0.1:9222");
  assert.throws(() => validateCdpUrl("http://192.0.2.20:9222"), /Remote CDP is disabled/);
  assert.equal(
    validateCdpUrl("https://browser.internal:9222", true),
    "https://browser.internal:9222",
  );
});
