import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { BrowserSession } from "./browser-session.js";
import { ChatGPTPage } from "./chatgpt-page.js";
import { validateChatGPTUrl } from "./config.js";
import { captureImages } from "./image-capture.js";
import { normalizePrompt, normalizeSourceImages } from "./validation.js";

function jobDirectoryName(jobId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${jobId}`;
}

export class ImageGenerator {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.session = dependencies.session || new BrowserSession(config);
    this.captureImages = dependencies.captureImages || captureImages;
    this.tail = Promise.resolve();
  }

  generate(input) {
    const task = this.tail.then(() => this.runGeneration(input));
    this.tail = task.catch(() => {});
    return task;
  }

  check() {
    const task = this.tail.then(() => this.runCheck());
    this.tail = task.catch(() => {});
    return task;
  }

  async runCheck() {
    const page = await this.session.getPage(this.config.chatgptUrl);
    const adapter = new ChatGPTPage(page, this.config);
    const status = await adapter.assertReady();
    return {
      ...status,
      browserMode: this.config.cdpUrl ? "cdp" : "dedicated_profile",
    };
  }

  async runGeneration(input) {
    const prompt = normalizePrompt(input?.prompt);
    const sourceImages = await normalizeSourceImages(input?.source_images, this.config);
    const chatgptUrl = validateChatGPTUrl(input?.chatgpt_url || this.config.chatgptUrl);
    const jobId = randomUUID();
    const outputDir = path.join(this.config.outputDir, jobDirectoryName(jobId));
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });

    const page = await this.session.getPage(chatgptUrl);
    const adapter = new ChatGPTPage(page, this.config);
    const candidates = await adapter.generate(prompt, sourceImages);
    const images = await this.captureImages(page, candidates, outputDir, this.config.maxImageBytes);

    return {
      ok: true,
      jobId,
      chatgptUrl,
      outputDir,
      images,
    };
  }

  async close() {
    await this.session.close();
  }
}
