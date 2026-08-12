import assert from "node:assert/strict";
import test from "node:test";

import { BrowserSession } from "../src/browser-session.js";

function makeSession(initialUrl, finalUrl) {
  let currentUrl = initialUrl;
  const page = {
    url() {
      return currentUrl;
    },
    async goto() {
      currentUrl = finalUrl;
    },
  };
  const session = new BrowserSession({});
  session.getContext = async () => ({
    pages: () => [page],
    newPage: async () => page,
  });
  return session;
}

test("allows navigation that stays on HTTPS chatgpt.com", async () => {
  const session = makeSession("about:blank", "https://chatgpt.com/images/");
  const page = await session.getPage("https://chatgpt.com/images/");
  assert.equal(page.url(), "https://chatgpt.com/images/");
});

test("rejects a target URL outside the ChatGPT allowlist before navigation", async () => {
  const session = makeSession("about:blank", "https://example.com/");
  await assert.rejects(
    session.getPage("https://example.com/"),
    (error) => error?.code === "CHATGPT_NAVIGATION_BLOCKED",
  );
});

test("rejects a redirect that leaves the ChatGPT allowlist", async () => {
  const session = makeSession("about:blank", "https://example.com/redirected");
  await assert.rejects(
    session.getPage("https://chatgpt.com/images/"),
    (error) => error?.code === "CHATGPT_NAVIGATION_BLOCKED",
  );
});
