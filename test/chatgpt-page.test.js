import assert from "node:assert/strict";
import test from "node:test";

import { candidateKey, compactImageSource, diffCandidates } from "../src/chatgpt-page.js";

test("diffCandidates returns only unique newly visible images", () => {
  const old = { source: "https://chatgpt.com/old.png", width: 512, height: 512 };
  const fresh = { source: "https://chatgpt.com/new.png", width: 1024, height: 1024 };
  const result = diffCandidates(new Set([candidateKey(old)]), [old, fresh, fresh]);
  assert.deepEqual(result, [fresh]);
});

test("compactImageSource bounds data URL keys", () => {
  const source = `data:image/png;base64,${"a".repeat(1000)}`;
  const compact = compactImageSource(source);
  assert.ok(compact.length < source.length);
  assert.match(compact, /1022/);
});
