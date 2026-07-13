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
      output_dir: "",
      surface: "images",
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
