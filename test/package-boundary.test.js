import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(target)));
    } else {
      files.push(target);
    }
  }
  return files;
}

test("runtime package has no workflow-engine or direct model API coupling", async () => {
  const runtimeFiles = [
    ...(await sourceFiles(path.join(ROOT, "src"))),
    ...(await sourceFiles(path.join(ROOT, "bin"))),
    path.join(ROOT, "package.json"),
  ];
  const source = (await Promise.all(runtimeFiles.map((file) => fs.readFile(file, "utf8")))).join("\n");
  for (const forbidden of ["workflow_registry", "8188", "/images/generations", "comfy_client"] ) {
    assert.equal(source.toLowerCase().includes(forbidden), false, `runtime contains ${forbidden}`);
  }
});
