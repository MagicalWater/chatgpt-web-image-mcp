import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../src/cli-args.js";

test("parses repeated source images", () => {
  assert.deepEqual(
    parseCliArgs(["generate", "-p", "draw it", "-s", "a.png", "--source", "b.webp"]),
    {
      command: "generate",
      prompt: "draw it",
      source_images: ["a.png", "b.webp"],
      chatgpt_url: "",
      output_dir: "",
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
