import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  loadConfig,
  validateCdpUrl,
  validateChatGPTProjectUrl,
  validateChatGPTUrl,
} from "../src/config.js";

const TEST_PROFILE = "C:\\test\\chatgpt-profile";

function configOptions(overrides = {}) {
  return {
    homeDir: "/tmp/operator",
    runtimeConfig: { chromeUserDataDir: TEST_PROFILE },
    ...overrides,
  };
}

test("requires an explicit dedicated Chrome profile when CDP is not configured", () => {
  assert.throws(
    () => loadConfig({}, { homeDir: "/tmp/operator", runtimeConfig: {} }),
    (error) => error?.code === "INVALID_CONFIG" && /dedicated Chrome profile/.test(error.message),
  );
});

test("loads safe defaults with an explicitly configured dedicated profile", () => {
  const homeDir = path.resolve("/tmp/operator");
  const config = loadConfig({}, {
    homeDir,
    runtimeConfig: { chromeUserDataDir: TEST_PROFILE },
  });
  assert.equal(config.chatgptUrl, "https://chatgpt.com/");
  assert.equal(config.surface, "chat");
  assert.equal(config.projectUrl, "");
  assert.equal(config.characterProfile, "");
  assert.equal(config.styleProfile, "");
  assert.equal(config.settingsFile, path.join(homeDir, ".chatgpt-web-image-mcp", "settings.json"));
  assert.equal(config.chromeUserDataDir, path.resolve(TEST_PROFILE));
  assert.deepEqual(config.allowedInputDirs, []);
  assert.equal(config.accountSwitchCommand, "");
});

test("loads the optional account switch command from runtime config", () => {
  const config = loadConfig({}, {
    homeDir: "/tmp/operator",
    runtimeConfig: {
      chromeUserDataDir: TEST_PROFILE,
      accountSwitchCommand: "C:\\tools\\switch.cmd",
    },
  });
  assert.equal(config.accountSwitchCommand, "C:\\tools\\switch.cmd");
});

test("selects the dedicated Images URL from configuration", () => {
  const config = loadConfig({ CHATGPT_WEB_SURFACE: "images" }, configOptions());
  assert.equal(config.surface, "images");
  assert.equal(config.chatgptUrl, "https://chatgpt.com/images/");
});

test("infers the Images surface from an explicit Images URL", () => {
  const config = loadConfig(
    { CHATGPT_WEB_URL: "https://chatgpt.com/images/" },
    configOptions(),
  );
  assert.equal(config.surface, "images");
  assert.equal(config.chatgptUrl, "https://chatgpt.com/images/");
});

test("rejects an unknown configured surface", () => {
  assert.throws(
    () => loadConfig({ CHATGPT_WEB_SURFACE: "gallery" }, configOptions()),
    /chat, images/,
  );
});

test("accepts ChatGPT project URLs and rejects arbitrary hosts", () => {
  assert.equal(
    validateChatGPTUrl("https://chatgpt.com/g/example/project"),
    "https://chatgpt.com/g/example/project",
  );
  assert.throws(() => validateChatGPTUrl("https://example.com/"), /chatgpt\.com/);
  assert.throws(() => validateChatGPTUrl("http://chatgpt.com/"), /HTTPS/);
});

test("loads the fixed project and profile defaults from local settings", () => {
  const projectUrl = "https://chatgpt.com/g/g-p-fixed/project";
  const config = loadConfig(
    {},
    {
      ...configOptions(),
      localSettings: {
        project_url: projectUrl,
        project_name: "Image continuity",
        character_profile: "same person",
        style_profile: "same style",
      },
    },
  );
  assert.equal(config.chatgptUrl, projectUrl);
  assert.equal(config.projectUrl, projectUrl);
  assert.equal(config.projectName, "Image continuity");
  assert.equal(config.characterProfile, "same person");
  assert.equal(config.styleProfile, "same style");
});

test("environment profiles override local settings", () => {
  const config = loadConfig(
    { CHATGPT_CHARACTER_PROFILE: "environment person" },
    {
      ...configOptions(),
      localSettings: { character_profile: "saved person", style_profile: "saved style" },
    },
  );
  assert.equal(config.characterProfile, "environment person");
  assert.equal(config.styleProfile, "saved style");
});

test("CDP mode does not require a dedicated profile path", () => {
  const config = loadConfig(
    { CHATGPT_CDP_URL: "http://127.0.0.1:9222" },
    { homeDir: "/tmp/operator", runtimeConfig: {} },
  );
  assert.equal(config.cdpUrl, "http://127.0.0.1:9222");
  assert.equal(config.chromeUserDataDir, "");
});

test("validates fixed project home URLs", () => {
  assert.equal(
    validateChatGPTProjectUrl("https://chatgpt.com/g/g-p-example/project"),
    "https://chatgpt.com/g/g-p-example/project",
  );
  assert.throws(() => validateChatGPTProjectUrl("https://chatgpt.com/c/example"), /project home/);
});

test("restricts CDP to loopback unless explicitly enabled", () => {
  assert.equal(validateCdpUrl("http://127.0.0.1:9222"), "http://127.0.0.1:9222");
  assert.throws(() => validateCdpUrl("http://192.0.2.20:9222"), /Remote CDP is disabled/);
  assert.equal(
    validateCdpUrl("https://browser.internal:9222", true),
    "https://browser.internal:9222",
  );
});
