import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readLocalSettings, writeLocalSettings } from "../src/local-settings.js";

test("writes and reads only supported non-secret local settings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-image-settings-"));
  const filePath = path.join(root, "nested", "settings.json");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await writeLocalSettings(filePath, {
    project_url: "https://chatgpt.com/g/g-p-test/project",
    project_name: "Image project",
    character_profile: "same character",
    style_profile: "same style",
    cookie: "must-not-persist",
  });

  assert.deepEqual(readLocalSettings(filePath), {
    project_url: "https://chatgpt.com/g/g-p-test/project",
    project_name: "Image project",
    character_profile: "same character",
    style_profile: "same style",
  });
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);
});

test("returns empty settings when the file does not exist", () => {
  assert.deepEqual(readLocalSettings("/tmp/does-not-exist-chatgpt-image-settings.json"), {});
});
