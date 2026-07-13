import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { detectImageMime, normalizePrompt, normalizeSourceImages } from "../src/validation.js";

test("detects supported image signatures", () => {
  assert.equal(detectImageMime(Buffer.from("89504e470d0a1a0a", "hex")), "image/png");
  assert.equal(detectImageMime(Buffer.from("ffd8ff", "hex")), "image/jpeg");
  assert.equal(detectImageMime(Buffer.from("524946460000000057454250", "hex")), "image/webp");
  assert.equal(detectImageMime(Buffer.from("not an image")), "");
});

test("requires an allowlisted input root and real image data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-web-image-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const image = path.join(root, "input.png");
  await fs.writeFile(image, Buffer.from("89504e470d0a1a0a00000000", "hex"));
  const config = { allowedInputDirs: [root], maxSourceBytes: 1024 };
  assert.deepEqual(await normalizeSourceImages([image], config), [await fs.realpath(image)]);
  await assert.rejects(
    normalizeSourceImages([image], { ...config, allowedInputDirs: [] }),
    /upload is disabled/,
  );
});

test("normalizes prompts and enforces a length bound", () => {
  assert.equal(normalizePrompt("  draw a lake  "), "draw a lake");
  assert.throws(() => normalizePrompt(""), /non-empty/);
  assert.throws(() => normalizePrompt("x".repeat(12001)), /12000/);
});
