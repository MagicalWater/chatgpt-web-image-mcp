import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../src/cli-args.js";

test("parses repeated source images", () => {
  assert.deepEqual(
    parseCliArgs([
      "generate",
      "-p",
      "draw it",
      "-s",
      "a.png",
      "--source",
      "b.webp",
      "--surface",
      "images",
    ]),
    {
      command: "generate",
      prompt: "draw it",
      source_images: ["a.png", "b.webp"],
      chatgpt_url: "",
      character_profile: undefined,
      force_new: false,
      output_dir: "",
      project_name: "",
      project_url: "",
      style_profile: undefined,
      surface: "images",
      use_consistency: undefined,
    },
  );
});

test("rejects unknown arguments", () => {
  assert.throws(() => parseCliArgs(["generate", "--workflow-json", "x.json"]), /Unknown argument/);
});

test("accepts help as the first argument", () => {
  assert.equal(parseCliArgs(["--help"]).command, "help");
  assert.equal(parseCliArgs(["-h"]).command, "help");
});

test("requires a value after --surface", () => {
  assert.throws(() => parseCliArgs(["generate", "--surface"]), /requires chat or images/);
});

test("parses project setup and consistency options", () => {
  const args = parseCliArgs([
    "setup-project",
    "--project-name",
    "Image continuity",
    "--character",
    "same face",
    "--style",
    "ink painting",
    "--force-new",
  ]);
  assert.equal(args.project_name, "Image continuity");
  assert.equal(args.character_profile, "same face");
  assert.equal(args.style_profile, "ink painting");
  assert.equal(args.force_new, true);
});

test("supports disabling consistency for one generation", () => {
  assert.equal(parseCliArgs(["generate", "--no-consistency"]).use_consistency, false);
});
