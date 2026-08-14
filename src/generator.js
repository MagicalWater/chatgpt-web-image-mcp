import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { BrowserSession } from "./browser-session.js";
import { composeGenerationPrompt, resolveConsistencyProfiles } from "./consistency-profiles.js";
import { validateChatGPTUrl } from "./config.js";
import { captureImages } from "./image-capture.js";
import { ProjectManager } from "./project-manager.js";
import { createSurfaceAdapter } from "./surface-adapters.js";
import { resolveSurfaceTarget } from "./surface-config.js";
import { normalizeSourceImages } from "./validation.js";

export function runAccountSwitcher(command, platform = process.platform) {
  return new Promise((resolve, reject) => {
    let executable;
    let args;
    if (platform === "win32") {
      executable = "cmd.exe";
      args = ["/d", "/s", "/c", "call", command];
    } else if (platform === "darwin") {
      executable = "/bin/zsh";
      args = [command];
    } else {
      reject(new Error(`ChatGPT account switching is unsupported on platform: ${platform}`));
      return;
    }

    const child = spawn(executable, args, {
      windowsHide: platform === "win32" ? false : undefined,
      // Operator-facing switch wrappers may pause or prompt on failure. Do not
      // give an automated caller an interactive stdin handle or the MCP could hang.
      stdio: ["ignore", "inherit", "inherit"],
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `ChatGPT account switch command failed (code=${code ?? "null"}, signal=${signal ?? "none"}).`,
        ),
      );
    });
  });
}

function jobDirectoryName(jobId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${jobId}`;
}

export class ImageGenerator {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.session = dependencies.session || new BrowserSession(config);
    this.captureImages = dependencies.captureImages || captureImages;
    this.projectManager =
      dependencies.projectManager || new ProjectManager(config, this.session, dependencies.projectManagerDependencies);
    this.accountSwitcher =
      dependencies.accountSwitcher || (() => runAccountSwitcher(this.config.accountSwitchCommand));
    this.tail = Promise.resolve();
  }

  generate(input) {
    const task = this.tail.then(() => this.runGeneration(input));
    this.tail = task.catch(() => {});
    return task;
  }

  check(input = {}) {
    const task = this.tail.then(() => this.runCheck(input));
    this.tail = task.catch(() => {});
    return task;
  }

  setupProject(input = {}) {
    const task = this.tail.then(() => this.projectManager.setup(input));
    this.tail = task.catch(() => {});
    return task;
  }

  async runCheck(input = {}, timeoutMs = 20000) {
    const target = resolveSurfaceTarget(this.config, input);
    const chatgptUrl = validateChatGPTUrl(target.url);
    const page = await this.session.getPage(chatgptUrl);
    const adapter = createSurfaceAdapter(target.surface, page, this.config);
    const status = await adapter.assertReady(timeoutMs);
    return {
      ...status,
      browserMode: this.config.cdpUrl ? "cdp" : "dedicated_profile",
      surface: target.surface,
    };
  }

  async runGeneration(input) {
    try {
      return await this.runGenerationAttempt(input);
    } catch (error) {
      if (
        error?.code !== "IMAGE_GENERATION_QUOTA_EXHAUSTED" ||
        !["win32", "darwin"].includes(process.platform) ||
        !this.config.accountSwitchCommand
      ) {
        await this.session.close().catch(() => {});
        throw error;
      }

      await this.session.close();
      await this.accountSwitcher();
      try {
        return await this.runGenerationAttempt(input);
      } catch (retryError) {
        await this.session.close().catch(() => {});
        throw retryError;
      }
    }
  }

  async runGenerationAttempt(input) {
    const profiles = resolveConsistencyProfiles(this.config, input);
    const prompt = composeGenerationPrompt(input?.prompt, profiles);
    const sourceImages = await normalizeSourceImages(input?.source_images, this.config);
    const target = resolveSurfaceTarget(this.config, input);
    const chatgptUrl = validateChatGPTUrl(target.url);
    const jobId = randomUUID();
    const outputDir = path.join(this.config.outputDir, jobDirectoryName(jobId));
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });

    const page = await this.session.getPage(chatgptUrl);
    const adapter = createSurfaceAdapter(target.surface, page, this.config);
    const candidates = await adapter.generate(prompt, sourceImages);
    const images = await this.captureImages(page, candidates, outputDir, this.config.maxImageBytes);

    return {
      ok: true,
      jobId,
      chatgptUrl,
      surface: target.surface,
      outputDir,
      images,
      consistency: {
        character: Boolean(profiles.characterProfile),
        style: Boolean(profiles.styleProfile),
      },
    };
  }

  async close() {
    await this.session.close();
  }
}
