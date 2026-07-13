import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultSurfaceUrl,
  inferSurfaceFromUrl,
  normalizeSurface,
  resolveSurfaceTarget,
} from "../src/surface-config.js";
import { ChatGPTPage } from "../src/chatgpt-page.js";
import { ImagesPage, IMAGES_SURFACE_SELECTORS } from "../src/images-page.js";
import { createSurfaceAdapter } from "../src/surface-adapters.js";

test("normalizes supported web surfaces", () => {
  assert.equal(normalizeSurface("CHAT"), "chat");
  assert.equal(normalizeSurface(" images "), "images");
  assert.throws(() => normalizeSurface("project"), /chat, images/);
});

test("maps surfaces to their default URLs", () => {
  assert.equal(defaultSurfaceUrl("chat"), "https://chatgpt.com/");
  assert.equal(defaultSurfaceUrl("images"), "https://chatgpt.com/images/");
});

test("infers the Images adapter from an Images URL", () => {
  assert.equal(inferSurfaceFromUrl("https://chatgpt.com/images/", "chat"), "images");
  assert.equal(inferSurfaceFromUrl("https://chatgpt.com/c/example", "chat"), "chat");
});

test("a per-call surface switch receives that surface default URL", () => {
  const config = { surface: "chat", chatgptUrl: "https://chatgpt.com/g/example/project" };
  assert.deepEqual(resolveSurfaceTarget(config, { surface: "images" }), {
    surface: "images",
    url: "https://chatgpt.com/images/",
  });
  assert.deepEqual(resolveSurfaceTarget(config, { surface: "images", chatgpt_url: "https://chatgpt.com/images/" }), {
    surface: "images",
    url: "https://chatgpt.com/images/",
  });
  assert.deepEqual(resolveSurfaceTarget(config, { chatgpt_url: "https://chatgpt.com/images/" }), {
    surface: "images",
    url: "https://chatgpt.com/images/",
  });
});

test("switching from Images to chat uses the configured fixed project", () => {
  const projectUrl = "https://chatgpt.com/g/g-p-fixed/project";
  assert.deepEqual(
    resolveSurfaceTarget(
      {
        surface: "images",
        chatgptUrl: "https://chatgpt.com/images/",
        projectUrl,
      },
      { surface: "chat" },
    ),
    { surface: "chat", url: projectUrl },
  );
});

test("the Images surface uses its own page adapter and attachment selector", () => {
  assert.ok(createSurfaceAdapter("chat", {}, {}) instanceof ChatGPTPage);
  assert.ok(createSurfaceAdapter("images", {}, {}) instanceof ImagesPage);
  assert.match(IMAGES_SURFACE_SELECTORS.attach, /附加图片/);
});
