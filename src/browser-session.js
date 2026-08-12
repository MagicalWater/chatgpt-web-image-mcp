import fs from "node:fs/promises";

import { chromium } from "playwright-core";

import { UserFacingError } from "./errors.js";

function isAllowedChatGPTUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com"))
    );
  } catch {
    return false;
  }
}

function isChatGPTPage(page) {
  return isAllowedChatGPTUrl(page.url());
}

function assertAllowedChatGPTUrl(value) {
  if (!isAllowedChatGPTUrl(value)) {
    throw new UserFacingError(
      "ChatGPT navigation left the allowed HTTPS chatgpt.com origin.",
      "CHATGPT_NAVIGATION_BLOCKED",
    );
  }
}

export class BrowserSession {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.ownsContext = false;
  }

  async getContext() {
    if (this.context) {
      return this.context;
    }
    try {
      if (this.config.cdpUrl) {
        this.browser = await chromium.connectOverCDP(this.config.cdpUrl);
        this.context = this.browser.contexts()[0];
        if (!this.context) {
          throw new UserFacingError(
            "The Chrome debugging endpoint has no browser context",
            "CDP_CONTEXT_MISSING",
          );
        }
        return this.context;
      }

      await fs.mkdir(this.config.chromeUserDataDir, { recursive: true, mode: 0o700 });
      this.context = await chromium.launchPersistentContext(this.config.chromeUserDataDir, {
        acceptDownloads: true,
        channel: this.config.chromeChannel,
        headless: this.config.headless,
        viewport: { width: 1440, height: 1100 },
      });
      this.ownsContext = true;
      return this.context;
    } catch (error) {
      if (error instanceof UserFacingError) {
        throw error;
      }
      throw new UserFacingError(
        "Could not open the dedicated Chrome session. Run `chatgpt-web-image login` locally.",
        "BROWSER_START_FAILED",
        { cause: error },
      );
    }
  }

  async getPage(targetUrl) {
    assertAllowedChatGPTUrl(targetUrl);
    const context = await this.getContext();
    const pages = context.pages();
    const page = pages.find(isChatGPTPage) || pages[0] || (await context.newPage());
    if (page.url() !== targetUrl) {
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      } catch (error) {
        if (error instanceof UserFacingError) {
          throw error;
        }
        throw new UserFacingError(
          "Could not open ChatGPT in Chrome. Check the browser network connection.",
          "CHATGPT_NAVIGATION_FAILED",
          { cause: error },
        );
      }
    }
    assertAllowedChatGPTUrl(page.url());
    return page;
  }

  async close() {
    if (this.ownsContext && this.context) {
      await this.context.close().catch(() => {});
    }
    // A CDP connection belongs to the operator. Let process exit disconnect it
    // without closing the user's Chrome browser.
    this.context = null;
    this.browser = null;
    this.ownsContext = false;
  }
}
