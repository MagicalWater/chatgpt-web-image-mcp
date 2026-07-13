import assert from "node:assert/strict";
import test from "node:test";

import {
  composeGenerationPrompt,
  normalizeProfile,
  resolveConsistencyProfiles,
} from "../src/consistency-profiles.js";

test("applies configured character and style profiles to a generation prompt", () => {
  const profiles = resolveConsistencyProfiles(
    { characterProfile: "same face and black bob", styleProfile: "watercolor storybook" },
    {},
  );
  assert.equal(
    composeGenerationPrompt("walking beside a lake", profiles),
    "[人物一致性]\nsame face and black bob\n\n[画风一致性]\nwatercolor storybook\n\n[本次画面]\nwalking beside a lake",
  );
});

test("supports per-call profile overrides and disabling consistency", () => {
  const config = { characterProfile: "default person", styleProfile: "default style" };
  assert.deepEqual(resolveConsistencyProfiles(config, { character_profile: "override" }), {
    characterProfile: "override",
    styleProfile: "default style",
  });
  assert.deepEqual(resolveConsistencyProfiles(config, { use_consistency: false }), {
    characterProfile: "",
    styleProfile: "",
  });
  assert.equal(
    composeGenerationPrompt("plain prompt", { characterProfile: "", styleProfile: "" }),
    "plain prompt",
  );
});

test("bounds individual profiles and the composed prompt", () => {
  assert.throws(() => normalizeProfile("x".repeat(4001), "character_profile"), /4000/);
  assert.throws(
    () =>
      composeGenerationPrompt("x".repeat(11990), {
        characterProfile: "character",
        styleProfile: "",
      }),
    /prompt plus consistency profiles/,
  );
});
