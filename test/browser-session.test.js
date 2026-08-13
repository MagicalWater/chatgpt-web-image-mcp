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

test("persistent browser launch releases profile lease after launch failure", async () => {
  let released = 0;
  const session = new BrowserSession(
    {
      chromeUserDataDir: "C:/profile",
      chromeChannel: "chrome",
      headless: false,
    },
    {
      acquireProfileLease: async () => ({ release: async () => { released += 1; } }),
      launchPersistentContext: async () => { throw new Error("launch failed"); },
    },
  );
  await assert.rejects(session.getContext(), (error) => error?.code === "BROWSER_START_FAILED");
  assert.equal(released, 1);
});

test("persistent browser context holds lease until normal close", async () => {
  let released = 0;
  let closed = 0;
  const session = new BrowserSession(
    {
      chromeUserDataDir: "C:/profile",
      chromeChannel: "chrome",
      headless: false,
    },
    {
      acquireProfileLease: async () => ({ release: async () => { released += 1; } }),
      launchPersistentContext: async () => ({
        async close() { closed += 1; },
      }),
    },
  );
  await session.getContext();
  assert.equal(released, 0);
  await session.close();
  assert.equal(closed, 1);
  assert.equal(released, 1);
});

test("CDP mode does not acquire a persistent-profile lease", async () => {
  let acquired = 0;
  const context = {};
  const session = new BrowserSession(
    { cdpUrl: "http://127.0.0.1:9222" },
    {
      acquireProfileLease: async () => { acquired += 1; },
      connectOverCDP: async () => ({ contexts: () => [context] }),
    },
  );
  assert.equal(await session.getContext(), context);
  assert.equal(acquired, 0);
  await session.close();
});
