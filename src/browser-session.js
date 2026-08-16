import fs from "node:fs/promises";

import { chromium } from "playwright-core";

import { acquireBrowserProfileLease } from "./browser-profile-lease.js";
import { isDedicatedChromeProfileRunning } from "./browser-process.js";
import { UserFacingError } from "./errors.js";

const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = 5000;

async function settleWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(
        () => "settled",
        () => "settled",
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  constructor(config, dependencies = {}) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.ownsContext = false;
    this.profileLease = null;
    this.cleanupBlocked = false;
    this.acquireProfileLease = dependencies.acquireProfileLease ?? acquireBrowserProfileLease;
    this.isDedicatedChromeProfileRunning = dependencies.isDedicatedChromeProfileRunning
      ?? isDedicatedChromeProfileRunning;
    this.connectOverCDP = dependencies.connectOverCDP ?? ((url) => chromium.connectOverCDP(url));
    this.launchPersistentContext = dependencies.launchPersistentContext
      ?? ((userDataDir, options) => chromium.launchPersistentContext(userDataDir, options));
  }

  async getContext() {
    if (this.cleanupBlocked) {
      await this.close();
    }
    if (this.context) {
      return this.context;
    }
    try {
      if (this.config.cdpUrl) {
        this.browser = await this.connectOverCDP(this.config.cdpUrl);
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
      this.profileLease = await this.acquireProfileLease(this.config.chromeUserDataDir, {
        timeoutMs: this.config.profileLeaseTimeoutMs,
      });
      try {
        this.context = await this.launchPersistentContext(this.config.chromeUserDataDir, {
          acceptDownloads: true,
          channel: this.config.chromeChannel,
          headless: this.config.headless,
          viewport: { width: 1440, height: 1100 },
        });
      } catch (error) {
        await this.profileLease.release().catch(() => {});
        this.profileLease = null;
        throw error;
      }
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
    if (this.cleanupBlocked) {
      let stillRunning = true;
      try {
        stillRunning = await this.isDedicatedChromeProfileRunning(this.config.chromeUserDataDir);
      } catch {
        stillRunning = true;
      }
      if (stillRunning) {
        throw new UserFacingError(
          "The dedicated Chrome process did not exit within the browser cleanup deadline.",
          "BROWSER_CLOSE_TIMEOUT",
        );
      }
      if (this.profileLease) {
        await this.profileLease.release().catch(() => {});
      }
      this.context = null;
      this.browser = null;
      this.ownsContext = false;
      this.profileLease = null;
      this.cleanupBlocked = false;
      return;
    }

    if (this.ownsContext && this.context) {
      const closeState = await settleWithin(
        this.context.close(),
        this.config.browserCloseTimeoutMs ?? DEFAULT_BROWSER_CLOSE_TIMEOUT_MS,
      );
      if (closeState === "timeout") {
        let stillRunning = true;
        try {
          stillRunning = await this.isDedicatedChromeProfileRunning(this.config.chromeUserDataDir);
        } catch {
          stillRunning = true;
        }
        if (stillRunning) {
          this.cleanupBlocked = true;
          throw new UserFacingError(
            "The dedicated Chrome process did not exit within the browser cleanup deadline.",
            "BROWSER_CLOSE_TIMEOUT",
          );
        }
      }
    }
    if (this.profileLease) {
      await this.profileLease.release().catch(() => {});
    }
    // A CDP connection belongs to the operator. Let process exit disconnect it
    // without closing the user's Chrome browser.
    this.context = null;
    this.browser = null;
    this.ownsContext = false;
    this.profileLease = null;
    this.cleanupBlocked = false;
  }
}
