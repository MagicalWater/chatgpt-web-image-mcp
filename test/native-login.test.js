import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNativeChromeLaunch,
  launchNativeChromeForLogin,
} from "../src/native-login.js";

test("buildNativeChromeLaunch uses a real Chrome executable and dedicated user-data-dir", () => {
  const launch = buildNativeChromeLaunch({
    platform: "darwin",
    chromeUserDataDir: "/Users/test/.chatgpt-web-image-mcp/chrome-profile",
    chatgptUrl: "https://chatgpt.com/images/",
  });

  assert.equal(
    launch.command,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  );
  assert.deepEqual(launch.args, [
    "--user-data-dir=/Users/test/.chatgpt-web-image-mcp/chrome-profile",
    "--password-store=basic",
    "--use-mock-keychain",
    "--new-window",
    "https://chatgpt.com/images/",
  ]);
  assert.equal(launch.args.some((arg) => arg.includes("remote-debugging")), false);
  assert.equal(launch.args.some((arg) => arg.includes("automation")), false);
});

test("buildNativeChromeLaunch refuses navigation outside HTTPS chatgpt.com", () => {
  assert.throws(
    () => buildNativeChromeLaunch({
      platform: "darwin",
      chromeUserDataDir: "/tmp/dedicated-profile",
      chatgptUrl: "https://example.com/phishing",
    }),
    /ChatGPT URL|chatgpt\.com/i,
  );
});

test("launchNativeChromeForLogin waits for the native Chrome process to exit", async () => {
  const calls = [];
  const fakeChild = {
    once(event, callback) {
      calls.push(event);
      if (event === "exit") {
        queueMicrotask(() => callback(0, null));
      }
      return this;
    },
  };

  await launchNativeChromeForLogin(
    {
      platform: "darwin",
      chromeUserDataDir: "/tmp/dedicated-profile",
      chatgptUrl: "https://chatgpt.com/",
    },
    {
      spawn(command, args, options) {
        assert.equal(
          command,
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        );
        assert.deepEqual(args, [
          "--user-data-dir=/tmp/dedicated-profile",
          "--password-store=basic",
          "--use-mock-keychain",
          "--new-window",
          "https://chatgpt.com/",
        ]);
        assert.deepEqual(options, { stdio: "ignore" });
        return fakeChild;
      },
    },
  );

  assert.deepEqual(calls, ["error", "exit"]);
});
