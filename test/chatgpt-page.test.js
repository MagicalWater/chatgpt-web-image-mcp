import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateKey,
  ChatGPTPage,
  compactImageSource,
  diffCandidates,
} from "../src/chatgpt-page.js";

test("diffCandidates returns only unique newly visible images", () => {
  const old = { source: "https://chatgpt.com/old.png", width: 512, height: 512 };
  const fresh = { source: "https://chatgpt.com/new.png", width: 1024, height: 1024 };
  const result = diffCandidates(new Set([candidateKey(old)]), [old, fresh, fresh]);
  assert.deepEqual(result, [fresh]);
});

test("compactImageSource bounds data URL keys", () => {
  const source = `data:image/png;base64,${"a".repeat(1000)}`;
  const compact = compactImageSource(source);
  assert.ok(compact.length < source.length);
  assert.match(compact, /1022/);
});

test("readiness rejects an unauthenticated ChatGPT session", async () => {
  const loginButton = {
    async count() {
      return 1;
    },
    async isVisible() {
      return true;
    },
    async waitFor() {
      throw new Error("still visible");
    },
  };
  const page = {
    locator(selector) {
      if (selector === "[data-testid='login-button']") {
        return { first: () => loginButton };
      }
      throw new Error(`unexpected selector: ${selector}`);
    },
  };
  const adapter = new ChatGPTPage(page, {});
  await assert.rejects(
    adapter.assertReady(1),
    (error) => error?.code === "CHATGPT_LOGIN_REQUIRED",
  );
});
