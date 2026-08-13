import { UserFacingError } from "./errors.js";

export function asAutomationPhaseError(error, code, message) {
  if (error instanceof UserFacingError) {
    return error;
  }
  return new UserFacingError(message, code, { cause: error });
}

export const IMAGE_SELECTOR = "main img, [role='main'] img, article img";
export const CHAT_SURFACE_SELECTORS = Object.freeze({
  prompt: [
    "#prompt-textarea",
    "[data-testid='prompt-textarea']",
    "textarea[placeholder*='Message']",
    "textarea[placeholder*='消息']",
    "div[contenteditable='true'][role='textbox']",
  ].join(", "),
  attach: [
    "[data-testid='composer-plus-btn']",
    "button[aria-label*='Attach']",
    "button[aria-label*='上传']",
    "button[aria-label*='添加']",
  ].join(", "),
  send: [
    "[data-testid='send-button']",
    "button[aria-label='Send prompt']",
    "button[aria-label='发送提示']",
    "button[aria-label='发送']",
  ].join(", "),
  generating: [
    "[data-testid='stop-button']",
    "button[aria-label*='Stop']",
    "button[aria-label*='停止']",
  ].join(", "),
});

export function compactImageSource(source) {
  if (source.length <= 500) {
    return source;
  }
  return `${source.slice(0, 240)}::${source.length}::${source.slice(-240)}`;
}

export function candidateKey(candidate) {
  return compactImageSource(candidate.source);
}

export function diffCandidates(beforeKeys, candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (!key || beforeKeys.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function isGeneratedImageCandidate(row) {
  return (
    row.source &&
    row.visible &&
    row.width >= 256 &&
    row.height >= 256 &&
    row.messageRole !== "user"
  );
}

async function listImageCandidates(page, selector = IMAGE_SELECTOR) {
  const rows = await page.locator(selector).evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      const message = image.closest("[data-message-author-role]");
      return {
        source: image.currentSrc || image.src || "",
        width: Math.max(image.naturalWidth || 0, Math.round(rect.width)),
        height: Math.max(image.naturalHeight || 0, Math.round(rect.height)),
        visible: rect.width > 0 && rect.height > 0,
        messageRole: message?.getAttribute("data-message-author-role") || "",
      };
    }),
  );
  return rows.filter(isGeneratedImageCandidate);
}

async function findPromptBox(page, selectors, timeoutMs = 20000) {
  const promptBox = page.locator(selectors.prompt).first();
  try {
    await promptBox.waitFor({ state: "visible", timeout: timeoutMs });
    return promptBox;
  } catch (error) {
    throw new UserFacingError(
      "The ChatGPT prompt box is unavailable. Open the dedicated profile and sign in first.",
      "CHATGPT_LOGIN_REQUIRED",
      { cause: error },
    );
  }
}

async function hasVisibleGuestAuthControl(page) {
  return page.evaluate(() => {
    const guestLabels = new Set([
      "log in",
      "sign up",
      "登入",
      "登录",
      "免費註冊",
      "免费注册",
      "註冊",
      "注册",
    ]);
    const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
    return Array.from(document.querySelectorAll("a, button")).some((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      return (
        guestLabels.has(normalize(element.textContent)) ||
        guestLabels.has(normalize(element.getAttribute("aria-label")))
      );
    });
  });
}

async function uploadSourceImages(page, sourceImages, selectors) {
  if (!sourceImages.length) {
    return;
  }
  let input = page.locator("input[type='file']").last();
  if ((await input.count()) === 0) {
    const attach = page.locator(selectors.attach).last();
    if ((await attach.count()) > 0) {
      await attach.click();
    }
    input = page.locator("input[type='file']").last();
  }
  try {
    await input.setInputFiles(sourceImages, { timeout: 15000 });
    await page.waitForTimeout(2500);
  } catch (error) {
    throw new UserFacingError(
      "ChatGPT did not accept the configured source image files.",
      "SOURCE_UPLOAD_FAILED",
      { cause: error },
    );
  }
}

async function fillPrompt(page, promptBox, prompt) {
  try {
    await promptBox.fill(prompt);
  } catch {
    await promptBox.click();
    await page.keyboard.insertText(prompt);
  }
}

async function promptBoxText(promptBox) {
  if (!promptBox) {
    return null;
  }
  return promptBox
    .evaluate((element) => {
      if ("value" in element) {
        return String(element.value || "").trim();
      }
      return String(element.textContent || "").trim();
    })
    .catch(() => null);
}

export async function submitPrompt(page, selectors, promptBox = null) {
  const beforeUrl = page.url();
  const sendButton = page.locator(selectors.send).last();
  if ((await sendButton.count()) > 0 && (await sendButton.isVisible().catch(() => false))) {
    try {
      await sendButton.click({ timeout: 5000 });
      return;
    } catch {
      await page.waitForTimeout(250).catch(() => {});
      const generating = await page
        .locator(selectors.generating)
        .count()
        .catch(() => 0);
      const afterUrl = page.url();
      const remainingPrompt = await promptBoxText(promptBox);
      if (generating > 0 || afterUrl !== beforeUrl || remainingPrompt === "") {
        return;
      }
    }
  }
  await page.keyboard.press("Enter");
}

export async function waitForGeneratedImages(
  page,
  beforeKeys,
  timeoutMs,
  maxImages,
  selectors,
  dependencies = {},
) {
  const listCandidates = dependencies.listCandidates || listImageCandidates;
  const now = dependencies.now || Date.now;
  const pollMs = dependencies.pollMs ?? 1000;
  const stableMs = dependencies.stableMs ?? 4000;
  const deadline = now() + timeoutMs;
  let stableSignature = "";
  let stableSince = 0;
  let lastScanError = null;

  while (now() < deadline) {
    let scanned;
    try {
      scanned = await listCandidates(page, selectors.image || IMAGE_SELECTOR);
      lastScanError = null;
    } catch (error) {
      lastScanError = error;
      await page.waitForTimeout(pollMs);
      continue;
    }
    const candidates = diffCandidates(beforeKeys, scanned).slice(0, maxImages);
    const signature = candidates.map(candidateKey).join("|");
    if (signature && signature === stableSignature) {
      stableSince ||= now();
    } else {
      stableSignature = signature;
      stableSince = signature ? now() : 0;
    }

    const generating = await page
      .locator(selectors.generating)
      .count()
      .catch(() => 0);
    if (candidates.length && !generating && now() - stableSince >= stableMs) {
      return candidates;
    }
    await page.waitForTimeout(pollMs);
  }
  if (lastScanError) {
    throw new UserFacingError(
      "Could not inspect the generated ChatGPT image result.",
      "IMAGE_RESULT_SCAN_FAILED",
      { cause: lastScanError },
    );
  }
  throw new UserFacingError(
    "Timed out waiting for a newly generated image in ChatGPT.",
    "IMAGE_GENERATION_TIMEOUT",
  );
}

export class ChatGPTPage {
  constructor(page, config, selectors = CHAT_SURFACE_SELECTORS) {
    this.page = page;
    this.config = config;
    this.selectors = selectors;
  }

  async assertReady(timeoutMs = 20000) {
    await findPromptBox(this.page, this.selectors, timeoutMs);
    if (await hasVisibleGuestAuthControl(this.page)) {
      throw new UserFacingError(
        "The dedicated ChatGPT profile is not signed in. Run `chatgpt-web-image login` locally.",
        "CHATGPT_LOGIN_REQUIRED",
      );
    }
    return { ready: true, url: this.page.url() };
  }

  async generate(prompt, sourceImages) {
    await this.assertReady();
    const promptBox = await findPromptBox(this.page, this.selectors);
    await uploadSourceImages(this.page, sourceImages, this.selectors);
    let beforeKeys;
    try {
      beforeKeys = new Set(
        (await listImageCandidates(this.page, this.selectors.image || IMAGE_SELECTOR)).map(candidateKey),
      );
    } catch (error) {
      throw asAutomationPhaseError(
        error,
        "IMAGE_CANDIDATE_SCAN_FAILED",
        "Could not inspect ChatGPT image candidates before generation.",
      );
    }
    try {
      await fillPrompt(this.page, promptBox, prompt);
    } catch (error) {
      throw asAutomationPhaseError(
        error,
        "PROMPT_FILL_FAILED",
        "Could not fill the ChatGPT image prompt.",
      );
    }
    try {
      await submitPrompt(this.page, this.selectors, promptBox);
    } catch (error) {
      throw asAutomationPhaseError(
        error,
        "PROMPT_SUBMIT_FAILED",
        "Could not submit the ChatGPT image prompt.",
      );
    }
    try {
      return await waitForGeneratedImages(
        this.page,
        beforeKeys,
        this.config.timeoutMs,
        this.config.maxImages,
        this.selectors,
      );
    } catch (error) {
      throw asAutomationPhaseError(
        error,
        "IMAGE_RESULT_SCAN_FAILED",
        "Could not inspect the generated ChatGPT image result.",
      );
    }
  }
}
