import assert from "node:assert/strict";
import test from "node:test";

import * as chatgptPageModule from "../src/chatgpt-page.js";

import {
  asAutomationPhaseError,
  candidateKey,
  ChatGPTPage,
  compactImageSource,
  dismissRateLimitDialog,
  diffCandidates,
  isGeneratedImageCandidate,
  submitPrompt,
  waitForGeneratedImages,
} from "../src/chatgpt-page.js";
import { UserFacingError } from "../src/errors.js";
import { IMAGES_SURFACE_SELECTORS } from "../src/images-page.js";

function fakePage({ guestStates = [false] } = {}) {
  let guestIndex = 0;
  return {
    locator() {
      return {
        first() {
          return {
            async waitFor() {},
          };
        },
      };
    },
    async evaluate() {
      const index = Math.min(guestIndex, guestStates.length - 1);
      guestIndex += 1;
      return guestStates[index];
    },
    async waitForTimeout() {},
    url() {
      return "https://chatgpt.com/";
    },
  };
}

test("diffCandidates returns only unique newly visible images", () => {
  const old = { source: "https://chatgpt.com/old.png", width: 512, height: 512 };
  const fresh = { source: "https://chatgpt.com/new.png", width: 1024, height: 1024 };
  const result = diffCandidates(new Set([candidateKey(old)]), [old, fresh, fresh]);
  assert.deepEqual(result, [fresh]);
});

test("chat candidate provenance rejects user-authored source images", () => {
  const base = {
    source: "https://chatgpt.com/source.png",
    width: 1280,
    height: 720,
    visible: true,
  };
  assert.equal(isGeneratedImageCandidate({ ...base, messageRole: "user" }), false);
  assert.equal(isGeneratedImageCandidate({ ...base, messageRole: "assistant" }), true);
  assert.equal(isGeneratedImageCandidate({ ...base, messageRole: "" }), true);
});

test("compactImageSource bounds data URL keys", () => {
  const source = `data:image/png;base64,${"a".repeat(1000)}`;
  const compact = compactImageSource(source);
  assert.ok(compact.length < source.length);
  assert.match(compact, /1022/);
});

test("assertReady rejects a guest page even when the prompt box is visible", async () => {
  const adapter = new ChatGPTPage(fakePage({ guestStates: [true] }), {});

  await assert.rejects(adapter.assertReady(100), (error) => {
    assert.equal(error.code, "CHATGPT_LOGIN_REQUIRED");
    return true;
  });
});

test("rate-limit dialog is dismissed without failing the flow", async () => {
  let dismissed = 0;
  const page = {
    async evaluate() {
      dismissed += 1;
      return {
        matched: true,
        dismissed: true,
        title: "太多要求",
        message: "你的要求過於頻繁。為了保護你的資料，我們已暫時限制了你的對話存取權限。",
      };
    },
  };

  const result = await dismissRateLimitDialog(page);
  assert.equal(result, true);
  assert.equal(dismissed, 1);
});

test("result polling dismisses the rate-limit dialog and keeps waiting", async () => {
  let virtualNow = 0;
  let scanCalls = 0;
  let dialogCalls = 0;
  let evaluateCalls = 0;
  const page = {
    async evaluate() {
      evaluateCalls += 1;
      if (evaluateCalls % 2 === 1) return "";
      dialogCalls += 1;
      if (dialogCalls > 1) return { matched: false };
      return {
        matched: true,
        dismissed: true,
        title: "太多要求",
        message: "請稍等幾分鐘後再試一次。",
      };
    },
    locator() {
      return { async count() { return 0; } };
    },
    async waitForTimeout(ms) {
      virtualNow += ms;
    },
  };

  await assert.rejects(
    waitForGeneratedImages(
      page,
      new Set(),
      2,
      4,
      { image: "image", generating: "generating" },
      {
        async listCandidates() {
          scanCalls += 1;
          return [];
        },
        now: () => virtualNow,
        pollMs: 1,
        stableMs: 0,
      },
    ),
    (error) => {
      assert.equal(error.code, "IMAGE_GENERATION_TIMEOUT");
      return true;
    },
  );
  assert.ok(scanCalls > 0);
  assert.ok(dialogCalls > 0);
});

test("result polling fails fast on image-generation quota exhaustion", async () => {
  let virtualNow = 0;
  let scanCalls = 0;
  const page = {
    async evaluate() {
      return ["你目前已用完圖片生成次數，請於約 4 小時內再試"];
    },
    locator() {
      return { async count() { return 0; } };
    },
    async waitForTimeout(ms) {
      virtualNow += ms;
    },
  };

  await assert.rejects(
    waitForGeneratedImages(
      page,
      new Set(),
      20,
      4,
      { image: "image", generating: "generating" },
      {
        async listCandidates() {
          scanCalls += 1;
          return [];
        },
        now: () => virtualNow,
        pollMs: 1,
        stableMs: 0,
      },
    ),
    (error) => {
      assert.equal(error.code, "IMAGE_GENERATION_QUOTA_EXHAUSTED");
      assert.match(error.message, /4 小時/);
      return true;
    },
  );
  assert.equal(scanCalls, 0);
});

test("quota text classifier recognizes the zh-TW exhaustion message", () => {
  assert.equal(typeof chatgptPageModule.classifyImageGenerationQuotaText, "function");
  const result = chatgptPageModule.classifyImageGenerationQuotaText(
    "你目前已用完圖片生成次數，請於約 4 小時內再試",
  );
  assert.equal(result?.quotaExhausted, true);
  assert.match(result?.quotaMessage || "", /4 小時/);
});

test("quota text classifier recognizes an English exhaustion message", () => {
  const result = chatgptPageModule.classifyImageGenerationQuotaText(
    "You've used all your image generation requests. Try again in about 3 hours.",
  );
  assert.equal(result?.quotaExhausted, true);
  assert.match(result?.quotaMessage || "", /3 hours/i);
});

test("quota text classifier does not confuse request-frequency dialogs with quota exhaustion", () => {
  const result = chatgptPageModule.classifyImageGenerationQuotaText(
    "太多要求 你的要求過於頻繁。請稍等幾分鐘後再試一次。",
  );
  assert.equal(result?.quotaExhausted, false);
});

test("quota text classifier keeps only the quota cooldown diagnostic", () => {
  const result = chatgptPageModule.classifyImageGenerationQuotaText(
    "PT 說：你目前已用完圖片生成次數，請於於 3 小時 內再試ChatGPT 可能會出錯。請查核重要資訊。",
  );
  assert.equal(result?.quotaExhausted, true);
  assert.match(result?.quotaMessage || "", /3 小時/);
  assert.doesNotMatch(result?.quotaMessage || "", /PT 說|ChatGPT 可能會出錯/);
});

test("Images surface restricts generated-image capture to imagegen result containers", () => {
  assert.equal(
    IMAGES_SURFACE_SELECTORS.image,
    "[class~='group/imagegen-image'] img",
  );
});

test("automation phase wrapper classifies unknown browser failures", () => {
  const error = asAutomationPhaseError(
    new Error("locator detached"),
    "IMAGE_CANDIDATE_SCAN_FAILED",
    "Could not inspect ChatGPT image candidates.",
  );
  assert.equal(error.code, "IMAGE_CANDIDATE_SCAN_FAILED");
  assert.equal(error.message, "Could not inspect ChatGPT image candidates.");
  assert.equal(error.cause?.message, "locator detached");
});

test("automation phase wrapper preserves already classified user-facing failures", () => {
  const original = new UserFacingError("Sign in", "CHATGPT_LOGIN_REQUIRED");
  assert.equal(
    asAutomationPhaseError(original, "PROMPT_FILL_FAILED", "Could not fill prompt."),
    original,
  );
});

test("submit falls back to Enter after bounded click failure with no submit evidence", async () => {
  let enterCalls = 0;
  const promptBox = {
    async evaluate() {
      return "still here";
    },
  };
  const sendButton = {
    async count() {
      return 1;
    },
    async isVisible() {
      return true;
    },
    async click(options) {
      assert.equal(options.timeout, 5000);
      throw new Error("actionability timeout");
    },
  };
  const page = {
    locator(selector) {
      if (selector === "send") return { last: () => sendButton };
      if (selector === "generating") return { async count() { return 0; } };
      throw new Error(`unexpected selector ${selector}`);
    },
    url() {
      return "https://chatgpt.com/images/";
    },
    async waitForTimeout() {},
    keyboard: {
      async press(key) {
        assert.equal(key, "Enter");
        enterCalls += 1;
      },
    },
  };

  await submitPrompt(page, { send: "send", generating: "generating" }, promptBox);
  assert.equal(enterCalls, 1);
});

test("submit does not press Enter when click timeout already started generation", async () => {
  let enterCalls = 0;
  const promptBox = {
    async evaluate() {
      return "";
    },
  };
  const sendButton = {
    async count() {
      return 1;
    },
    async isVisible() {
      return true;
    },
    async click() {
      throw new Error("actionability timeout");
    },
  };
  const page = {
    locator(selector) {
      if (selector === "send") return { last: () => sendButton };
      if (selector === "generating") return { async count() { return 1; } };
      throw new Error(`unexpected selector ${selector}`);
    },
    url() {
      return "https://chatgpt.com/images/";
    },
    async waitForTimeout() {},
    keyboard: {
      async press() {
        enterCalls += 1;
      },
    },
  };

  await submitPrompt(page, { send: "send", generating: "generating" }, promptBox);
  assert.equal(enterCalls, 0);
});

test("result polling recovers from a transient image scan failure without resubmitting", async () => {
  let scanCalls = 0;
  let virtualNow = 0;
  const fresh = {
    source: "https://chatgpt.com/generated.png",
    width: 1024,
    height: 1024,
  };
  const page = {
    async evaluate() {
      return { matched: false };
    },
    locator(selector) {
      assert.equal(selector, "generating");
      return { async count() { return 0; } };
    },
    async waitForTimeout(ms) {
      virtualNow += ms;
    },
  };

  const result = await waitForGeneratedImages(
    page,
    new Set(),
    20,
    4,
    { image: "image", generating: "generating" },
    {
      async listCandidates() {
        scanCalls += 1;
        if (scanCalls === 1) throw new Error("execution context destroyed");
        return [fresh];
      },
      now: () => virtualNow,
      pollMs: 1,
      stableMs: 0,
    },
  );

  assert.deepEqual(result, [fresh]);
  assert.equal(scanCalls, 2);
});

test("result polling preserves scan failure when every read fails until the deadline", async () => {
  let virtualNow = 0;
  const page = {
    async evaluate() {
      return { matched: false };
    },
    locator() {
      return { async count() { return 0; } };
    },
    async waitForTimeout(ms) {
      virtualNow += ms;
    },
  };

  await assert.rejects(
    waitForGeneratedImages(
      page,
      new Set(),
      3,
      4,
      { image: "image", generating: "generating" },
      {
        async listCandidates() {
          throw new Error("execution context destroyed");
        },
        now: () => virtualNow,
        pollMs: 1,
        stableMs: 0,
      },
    ),
    (error) => {
      assert.equal(error.code, "IMAGE_RESULT_SCAN_FAILED");
      assert.equal(error.cause?.message, "execution context destroyed");
      return true;
    },
  );
});
