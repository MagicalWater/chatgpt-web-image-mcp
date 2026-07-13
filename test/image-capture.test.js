import assert from "node:assert/strict";
import test from "node:test";

import { extensionForMime } from "../src/image-capture.js";

test("maps supported MIME types to output extensions", () => {
  assert.equal(extensionForMime("image/png"), "png");
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(extensionForMime("image/webp"), "webp");
  assert.equal(extensionForMime("application/octet-stream"), "png");
});
