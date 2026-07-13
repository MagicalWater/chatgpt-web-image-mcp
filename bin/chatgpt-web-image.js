#!/usr/bin/env node
import path from "node:path";

import { ChatGPTPage } from "../src/chatgpt-page.js";
import { loadConfig } from "../src/config.js";
import { parseCliArgs } from "../src/cli-args.js";
import { safeError, UserFacingError } from "../src/errors.js";
import { ImageGenerator } from "../src/generator.js";

const HELP = `chatgpt-web-image

Usage:
  chatgpt-web-image login
  chatgpt-web-image check
  chatgpt-web-image generate --prompt "Create a watercolor mountain landscape"
  chatgpt-web-image generate --prompt "Edit this image" --source /allowed/input.png

Options:
  -p, --prompt TEXT       Image prompt
  -s, --source PATH       Source image; repeatable
      --chatgpt-url URL   HTTPS chatgpt.com conversation or project URL
      --output-dir PATH   Override the output directory for this CLI run
  -h, --help              Show this help
`;

async function runLogin(generator, config) {
  const page = await generator.session.getPage(config.chatgptUrl);
  process.stderr.write(
    "A dedicated Chrome profile is open. Sign in to ChatGPT in that window; this command will continue when the prompt box is ready.\n",
  );
  const adapter = new ChatGPTPage(page, config);
  await adapter.assertReady(config.timeoutMs);
  process.stdout.write(`${JSON.stringify({ ok: true, ready: true, url: page.url() }, null, 2)}\n`);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === "help") {
    process.stdout.write(HELP);
    return;
  }
  const env = { ...process.env };
  if (args.output_dir) {
    env.CHATGPT_IMAGE_OUTPUT_DIR = path.resolve(args.output_dir);
  }
  const config = loadConfig(env);
  const generator = new ImageGenerator(config);
  try {
    if (args.command === "login") {
      await runLogin(generator, config);
      return;
    }
    if (args.command === "check") {
      process.stdout.write(`${JSON.stringify(await generator.check(), null, 2)}\n`);
      return;
    }
    if (args.command === "generate") {
      const result = await generator.generate({
        prompt: args.prompt,
        source_images: args.source_images,
        chatgpt_url: args.chatgpt_url || undefined,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    throw new UserFacingError(`Unknown command: ${args.command}`, "INVALID_ARGUMENT");
  } finally {
    await generator.close();
  }
}

main().catch((error) => {
  const safe = safeError(error);
  process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = 1;
});
