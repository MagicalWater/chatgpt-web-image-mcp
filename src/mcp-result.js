import fs from "node:fs/promises";

export async function toMcpContent(result, maxBytes) {
  const summary = {
    ok: result.ok,
    job_id: result.jobId,
    image_count: result.images.length,
    images: result.images.map((image) => ({
      path: image.filePath,
      mime_type: image.mimeType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      capture_method: image.captureMethod,
    })),
  };
  const content = [{ type: "text", text: JSON.stringify(summary, null, 2) }];
  for (const image of result.images) {
    if (image.bytes <= maxBytes) {
      content.push({
        type: "image",
        data: (await fs.readFile(image.filePath)).toString("base64"),
        mimeType: image.mimeType,
      });
    }
  }
  return content;
}
