import fs from "node:fs/promises";
import path from "node:path";

import { candidateKey, compactImageSource, IMAGE_SELECTOR } from "./chatgpt-page.js";
import { UserFacingError } from "./errors.js";

const MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export function extensionForMime(mimeType) {
  return MIME_EXTENSIONS.get(String(mimeType).toLowerCase()) || "png";
}

async function findImageHandle(page, candidate) {
  const targetKey = candidateKey(candidate);
  const handles = await page.locator(IMAGE_SELECTOR).elementHandles();
  for (const handle of handles) {
    const source = await handle.evaluate((image) => image.currentSrc || image.src || "");
    if (compactImageSource(source) === targetKey) {
      return handle;
    }
  }
  return null;
}

async function fetchImagePayload(page, handle) {
  return page.evaluate(async (image) => {
    const source = image.currentSrc || image.src || "";
    if (!source) {
      return null;
    }
    try {
      const response = await fetch(source, { credentials: "include" });
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const comma = String(dataUrl).indexOf(",");
      return {
        ok: comma > 0,
        mimeType: blob.type || "image/png",
        base64: comma > 0 ? String(dataUrl).slice(comma + 1) : "",
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }, handle);
}

async function captureOne(page, candidate, outputStem, maxBytes) {
  const handle = await findImageHandle(page, candidate);
  if (!handle) {
    throw new UserFacingError("A generated image disappeared before it could be saved.", "IMAGE_MISSING");
  }

  const payload = await fetchImagePayload(page, handle);
  if (payload?.ok && payload.base64) {
    const content = Buffer.from(payload.base64, "base64");
    if (content.length <= maxBytes) {
      const mimeType = MIME_EXTENSIONS.has(payload.mimeType) ? payload.mimeType : "image/png";
      const filePath = `${outputStem}.${extensionForMime(mimeType)}`;
      await fs.writeFile(filePath, content, { mode: 0o600 });
      return {
        filePath,
        mimeType,
        bytes: content.length,
        width: candidate.width,
        height: candidate.height,
        captureMethod: "authenticated_image_fetch",
      };
    }
  }

  const filePath = `${outputStem}.png`;
  await handle.screenshot({ path: filePath, type: "png" });
  const stat = await fs.stat(filePath);
  if (stat.size > maxBytes) {
    await fs.rm(filePath, { force: true });
    throw new UserFacingError(
      `Generated image exceeds the configured ${maxBytes}-byte limit`,
      "IMAGE_TOO_LARGE",
    );
  }
  return {
    filePath,
    mimeType: "image/png",
    bytes: stat.size,
    width: candidate.width,
    height: candidate.height,
    captureMethod: "visible_element_screenshot",
  };
}

export async function captureImages(page, candidates, outputDir, maxBytes) {
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const results = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const outputStem = path.join(outputDir, `image-${String(index + 1).padStart(2, "0")}`);
    results.push(await captureOne(page, candidates[index], outputStem, maxBytes));
  }
  return results;
}
