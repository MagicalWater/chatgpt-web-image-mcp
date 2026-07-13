import fs from "node:fs/promises";
import path from "node:path";

import { UserFacingError } from "./errors.js";

export const MAX_PROMPT_LENGTH = 12000;

export function normalizePrompt(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserFacingError("prompt must be a non-empty string", "INVALID_PROMPT");
  }
  const prompt = value.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new UserFacingError(
      `prompt must not exceed ${MAX_PROMPT_LENGTH} characters`,
      "INVALID_PROMPT",
    );
  }
  return prompt;
}

function isUnder(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function detectImageMime(header) {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString("ascii") === "RIFF" &&
    header.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

async function inspectSourceImage(inputPath, config) {
  const resolved = await fs.realpath(path.resolve(inputPath)).catch(() => "");
  if (!resolved) {
    throw new UserFacingError(`Source image does not exist: ${inputPath}`, "INVALID_SOURCE_IMAGE");
  }
  if (!config.allowedInputDirs.length) {
    throw new UserFacingError(
      "Source-image upload is disabled. Configure CHATGPT_IMAGE_ALLOWED_INPUT_DIRS first.",
      "INPUT_UPLOAD_DISABLED",
    );
  }
  const allowedRoots = await Promise.all(
    config.allowedInputDirs.map(async (root) => fs.realpath(path.resolve(root)).catch(() => path.resolve(root))),
  );
  if (!allowedRoots.some((root) => isUnder(resolved, root))) {
    throw new UserFacingError(
      `Source image is outside CHATGPT_IMAGE_ALLOWED_INPUT_DIRS: ${inputPath}`,
      "SOURCE_IMAGE_NOT_ALLOWED",
    );
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > config.maxSourceBytes) {
    throw new UserFacingError(
      `Source image must be a non-empty file no larger than ${config.maxSourceBytes} bytes`,
      "INVALID_SOURCE_IMAGE",
    );
  }
  const handle = await fs.open(resolved, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!detectImageMime(header.subarray(0, bytesRead))) {
      throw new UserFacingError(
        `Source image must contain PNG, JPEG, or WebP data: ${inputPath}`,
        "INVALID_SOURCE_IMAGE",
      );
    }
  } finally {
    await handle.close();
  }
  return resolved;
}

export async function normalizeSourceImages(values, config) {
  const inputs = values || [];
  if (!Array.isArray(inputs) || inputs.length > 8) {
    throw new UserFacingError("source_images must contain at most 8 paths", "INVALID_SOURCE_IMAGE");
  }
  return Promise.all(inputs.map((inputPath) => inspectSourceImage(inputPath, config)));
}
