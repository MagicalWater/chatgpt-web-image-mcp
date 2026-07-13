import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { UserFacingError } from "./errors.js";

const SETTINGS_KEYS = [
  "project_url",
  "project_name",
  "character_profile",
  "style_profile",
];

function normalizeSettingsObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserFacingError("The local settings file must contain a JSON object", "INVALID_SETTINGS");
  }
  return Object.fromEntries(
    SETTINGS_KEYS.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key].trim()]] : [],
    ),
  );
}

export function readLocalSettings(filePath) {
  try {
    return normalizeSettingsObject(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError("The local settings file contains invalid JSON", "INVALID_SETTINGS", {
      cause: error,
    });
  }
}

export async function writeLocalSettings(filePath, settings) {
  const normalized = normalizeSettingsObject(settings);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.settings-${randomUUID()}.tmp`);
  try {
    await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsPromises.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fsPromises.rename(temporaryPath, filePath);
    await fsPromises.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fsPromises.rm(temporaryPath, { force: true }).catch(() => {});
    throw new UserFacingError("Could not save the local project settings", "SETTINGS_WRITE_FAILED", {
      cause: error,
    });
  }
  return normalized;
}
