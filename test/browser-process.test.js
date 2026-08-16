import assert from "node:assert/strict";
import test from "node:test";

import { processLineUsesDedicatedChromeProfile } from "../src/browser-process.js";

test("macOS dedicated-profile detection ignores non-Chrome commands containing the profile path", () => {
  const profile = "/Users/water/project/chrome-profile-worker-b";
  assert.equal(
    processLineUsesDedicatedChromeProfile(
      `123 node switch-chatgpt-account.mjs --profile-path ${profile}`,
      profile,
      "darwin",
    ),
    false,
  );
  assert.equal(
    processLineUsesDedicatedChromeProfile(
      `456 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${profile} about:blank`,
      profile,
      "darwin",
    ),
    true,
  );
});

test("Windows dedicated-profile detection resolves Windows paths independent of the test host", () => {
  const profile = "D:\\Developer\\chatgpt-web-image-mcp-admission\\chrome-profile-worker-a";
  assert.equal(
    processLineUsesDedicatedChromeProfile(
      `456 chrome.exe --user-data-dir=${profile} about:blank`,
      profile,
      "win32",
    ),
    true,
  );
});
