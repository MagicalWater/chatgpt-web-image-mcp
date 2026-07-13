import { UserFacingError } from "./errors.js";

export const IMAGE_SELECTOR = "main img, [role='main'] img, article img";
const PROMPT_SELECTOR = [
  "#prompt-textarea",
  "[data-testid='prompt-textarea']",
  "textarea[placeholder*='Message']",
  "textarea[placeholder*='消息']",
  "div[contenteditable='true'][role='textbox']",
].join(", ");

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

async function listImageCandidates(page) {
  const rows = await page.locator(IMAGE_SELECTOR).evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        source: image.currentSrc || image.src || "",
        width: Math.max(image.naturalWidth || 0, Math.round(rect.width)),
        height: Math.max(image.naturalHeight || 0, Math.round(rect.height)),
        visible: rect.width > 0 && rect.height > 0,
      };
    }),
  );
  return rows.filter(
    (row) => row.source && row.visible && row.width >= 256 && row.height >= 256,
  );
}

async function findPromptBox(page, timeoutMs = 20000) {
  const promptBox = page.locator(PROMPT_SELECTOR).first();
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

async function uploadSourceImages(page, sourceImages) {
  if (!sourceImages.length) {
    return;
  }
  let input = page.locator("input[type='file']").last();
  if ((await input.count()) === 0) {
    const attach = page
      .locator(
        "[data-testid='composer-plus-btn'], button[aria-label*='Attach'], button[aria-label*='上传'], button[aria-label*='添加']",
      )
      .last();
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

async function submitPrompt(page) {
  const sendButton = page
    .locator(
      "[data-testid='send-button'], button[aria-label='Send prompt'], button[aria-label='发送提示'], button[aria-label='发送']",
    )
    .last();
  if ((await sendButton.count()) > 0 && (await sendButton.isVisible().catch(() => false))) {
    await sendButton.click();
    return;
  }
  await page.keyboard.press("Enter");
}

async function waitForGeneratedImages(page, beforeKeys, timeoutMs, maxImages) {
  const deadline = Date.now() + timeoutMs;
  let stableSignature = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    const candidates = diffCandidates(beforeKeys, await listImageCandidates(page)).slice(0, maxImages);
    const signature = candidates.map(candidateKey).join("|");
    if (signature && signature === stableSignature) {
      stableSince ||= Date.now();
    } else {
      stableSignature = signature;
      stableSince = signature ? Date.now() : 0;
    }

    const generating = await page
      .locator("[data-testid='stop-button'], button[aria-label*='Stop'], button[aria-label*='停止']")
      .count()
      .catch(() => 0);
    if (candidates.length && !generating && Date.now() - stableSince >= 4000) {
      return candidates;
    }
    await page.waitForTimeout(1000);
  }
  throw new UserFacingError(
    "Timed out waiting for a newly generated image in ChatGPT.",
    "IMAGE_GENERATION_TIMEOUT",
  );
}

export class ChatGPTPage {
  constructor(page, config) {
    this.page = page;
    this.config = config;
  }

  async assertReady(timeoutMs = 20000) {
    await findPromptBox(this.page, timeoutMs);
    return { ready: true, url: this.page.url() };
  }

  async generate(prompt, sourceImages) {
    const promptBox = await findPromptBox(this.page);
    await uploadSourceImages(this.page, sourceImages);
    const beforeKeys = new Set((await listImageCandidates(this.page)).map(candidateKey));
    await fillPrompt(this.page, promptBox, prompt);
    await submitPrompt(this.page);
    return waitForGeneratedImages(
      this.page,
      beforeKeys,
      this.config.timeoutMs,
      this.config.maxImages,
    );
  }
}
