import { ChatGPTPage } from "./chatgpt-page.js";
import { ImagesPage } from "./images-page.js";
import { normalizeSurface } from "./surface-config.js";

export function createSurfaceAdapter(surface, page, config) {
  return normalizeSurface(surface) === "images"
    ? new ImagesPage(page, config)
    : new ChatGPTPage(page, config);
}
