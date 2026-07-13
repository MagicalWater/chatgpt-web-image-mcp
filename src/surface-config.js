import { UserFacingError } from "./errors.js";

export const WEB_SURFACES = Object.freeze(["chat", "images"]);

export function normalizeSurface(value = "chat") {
  const surface = String(value || "chat").trim().toLowerCase();
  if (!WEB_SURFACES.includes(surface)) {
    throw new UserFacingError(
      `surface must be one of: ${WEB_SURFACES.join(", ")}`,
      "INVALID_SURFACE",
    );
  }
  return surface;
}

export function defaultSurfaceUrl(surface) {
  return normalizeSurface(surface) === "images"
    ? "https://chatgpt.com/images/"
    : "https://chatgpt.com/";
}

export function inferSurfaceFromUrl(value, fallback = "chat") {
  if (!value) {
    return normalizeSurface(fallback);
  }
  try {
    return new URL(value).pathname.startsWith("/images")
      ? "images"
      : normalizeSurface(fallback);
  } catch {
    return normalizeSurface(fallback);
  }
}

export function resolveSurfaceTarget(config, input = {}) {
  const requestedSurface = input.surface
    ? normalizeSurface(input.surface)
    : inferSurfaceFromUrl(input.chatgpt_url, config.surface);
  const switchedSurface = requestedSurface !== config.surface;
  const switchedUrl =
    requestedSurface === "chat" && config.projectUrl
      ? config.projectUrl
      : defaultSurfaceUrl(requestedSurface);
  const url = input.chatgpt_url || (switchedSurface ? switchedUrl : config.chatgptUrl);
  return { surface: requestedSurface, url };
}
