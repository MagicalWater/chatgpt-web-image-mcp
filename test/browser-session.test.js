import assert from "node:assert/strict";
import test from "node:test";

import { persistentContextOptions } from "../src/browser-session.js";

test("launches the dedicated Chrome profile with the Chromium sandbox enabled", () => {
  const options = persistentContextOptions({
    chromeChannel: "chrome",
    headless: false,
  });

  assert.equal(options.chromiumSandbox, true);
  assert.equal(options.channel, "chrome");
  assert.equal(options.headless, false);
  assert.deepEqual(options.viewport, { width: 1440, height: 1100 });
});
