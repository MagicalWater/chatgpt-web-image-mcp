import { UserFacingError } from "./errors.js";
import { MAX_PROMPT_LENGTH, normalizePrompt } from "./validation.js";

export const MAX_PROFILE_LENGTH = 4000;

export function normalizeProfile(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string") {
    throw new UserFacingError(`${fieldName} must be a string`, "INVALID_PROFILE");
  }
  const profile = value.trim();
  if (profile.length > MAX_PROFILE_LENGTH) {
    throw new UserFacingError(
      `${fieldName} must not exceed ${MAX_PROFILE_LENGTH} characters`,
      "INVALID_PROFILE",
    );
  }
  return profile;
}

export function resolveConsistencyProfiles(config, input = {}) {
  if (input.use_consistency === false) {
    return { characterProfile: "", styleProfile: "" };
  }
  const characterProfile = Object.hasOwn(input, "character_profile")
    ? normalizeProfile(input.character_profile, "character_profile")
    : normalizeProfile(config.characterProfile, "character_profile");
  const styleProfile = Object.hasOwn(input, "style_profile")
    ? normalizeProfile(input.style_profile, "style_profile")
    : normalizeProfile(config.styleProfile, "style_profile");
  return { characterProfile, styleProfile };
}

export function composeGenerationPrompt(promptValue, profiles) {
  const prompt = normalizePrompt(promptValue);
  const sections = [];
  if (profiles.characterProfile) {
    sections.push(`[人物一致性]\n${profiles.characterProfile}`);
  }
  if (profiles.styleProfile) {
    sections.push(`[画风一致性]\n${profiles.styleProfile}`);
  }
  if (!sections.length) {
    return prompt;
  }
  sections.push(`[本次画面]\n${prompt}`);
  const composed = sections.join("\n\n");
  if (composed.length > MAX_PROMPT_LENGTH) {
    throw new UserFacingError(
      `prompt plus consistency profiles must not exceed ${MAX_PROMPT_LENGTH} characters`,
      "INVALID_PROMPT",
    );
  }
  return composed;
}
