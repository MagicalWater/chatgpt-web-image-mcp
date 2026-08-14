import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { UserFacingError } from "./errors.js";
import {
  defaultSurfaceUrl,
  inferSurfaceFromUrl,
  normalizeSurface,
} from "./surface-config.js";
import { normalizeProfile } from "./consistency-profiles.js";
import { readLocalSettings } from "./local-settings.js";
import { isChatGPTProjectUrl } from "./project-page.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRuntimeConfig(configFile = path.join(PACKAGE_ROOT, "config.json")) {
  if (!fs.existsSync(configFile)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new UserFacingError("config.json must contain valid JSON", "INVALID_CONFIG");
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new UserFacingError(`Invalid boolean value: ${value}`, "INVALID_CONFIG");
}

function parseInteger(value, fallback, minimum, maximum, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UserFacingError(
      `${name} must be an integer between ${minimum} and ${maximum}`,
      "INVALID_CONFIG",
    );
  }
  return parsed;
}

export function expandHome(value, homeDir = os.homedir()) {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

export function validateChatGPTUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UserFacingError("CHATGPT_WEB_URL must be a valid URL", "INVALID_CHATGPT_URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "chatgpt.com" && !hostname.endsWith(".chatgpt.com")) ||
    url.username ||
    url.password
  ) {
    throw new UserFacingError(
      "Only credential-free HTTPS chatgpt.com URLs are allowed",
      "INVALID_CHATGPT_URL",
    );
  }
  return url.href;
}

export function validateChatGPTProjectUrl(value) {
  const url = validateChatGPTUrl(value);
  if (!isChatGPTProjectUrl(url)) {
    throw new UserFacingError(
      "The fixed project URL must be a ChatGPT project home URL",
      "INVALID_PROJECT_URL",
    );
  }
  return url;
}

export function validateCdpUrl(value, allowRemote = false) {
  if (!value) {
    return "";
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UserFacingError("CHATGPT_CDP_URL must be a valid URL", "INVALID_CDP_URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new UserFacingError("CHATGPT_CDP_URL must use HTTP(S) without credentials", "INVALID_CDP_URL");
  }
  if (!allowRemote && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new UserFacingError(
      "Remote CDP is disabled. Use a loopback URL or explicitly set CHATGPT_ALLOW_REMOTE_CDP=true",
      "REMOTE_CDP_DISABLED",
    );
  }
  return url.href.replace(/\/$/, "");
}

function parseAllowedInputDirs(value, homeDir) {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(expandHome(entry, homeDir)));
}

export function loadConfig(env = process.env, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const runtimeConfig = options.runtimeConfig || readRuntimeConfig(options.configFile);
  const allowRemoteCdp = parseBoolean(env.CHATGPT_ALLOW_REMOTE_CDP, false);
  const cdpUrl = validateCdpUrl(env.CHATGPT_CDP_URL || "", allowRemoteCdp);
  const chromeUserDataDirValue = String(
    runtimeConfig.chromeUserDataDir || env.CHATGPT_CHROME_USER_DATA_DIR || "",
  ).trim();
  if (!cdpUrl && !chromeUserDataDirValue) {
    throw new UserFacingError(
      "A dedicated Chrome profile must be configured with config.json chromeUserDataDir or CHATGPT_CHROME_USER_DATA_DIR",
      "INVALID_CONFIG",
    );
  }
  const root = path.join(homeDir, ".chatgpt-web-image-mcp");
  const settingsFile = path.resolve(
    expandHome(env.CHATGPT_SETTINGS_FILE || path.join(root, "settings.json"), homeDir),
  );
  const localSettings = options.localSettings || readLocalSettings(settingsFile);
  const projectUrlValue = env.CHATGPT_PROJECT_URL || localSettings.project_url || "";
  const projectUrl = projectUrlValue ? validateChatGPTProjectUrl(projectUrlValue) : "";
  const surface = env.CHATGPT_WEB_SURFACE
    ? normalizeSurface(env.CHATGPT_WEB_SURFACE)
    : inferSurfaceFromUrl(env.CHATGPT_WEB_URL, "chat");
  const defaultUrl = surface === "chat" && projectUrl ? projectUrl : defaultSurfaceUrl(surface);

  return {
    accountSwitchCommand: String(runtimeConfig.accountSwitchCommand || "").trim(),
    allowedInputDirs: parseAllowedInputDirs(env.CHATGPT_IMAGE_ALLOWED_INPUT_DIRS, homeDir),
    allowRemoteCdp,
    cdpUrl,
    characterProfile: normalizeProfile(
      env.CHATGPT_CHARACTER_PROFILE ?? localSettings.character_profile,
      "CHATGPT_CHARACTER_PROFILE",
    ),
    chatgptUrl: validateChatGPTUrl(env.CHATGPT_WEB_URL || defaultUrl),
    chromeChannel: env.CHATGPT_CHROME_CHANNEL || "chrome",
    chromeUserDataDir: chromeUserDataDirValue
      ? path.resolve(expandHome(chromeUserDataDirValue, homeDir))
      : "",
    headless: parseBoolean(env.CHATGPT_HEADLESS, false),
    maxImageBytes: parseInteger(
      env.CHATGPT_IMAGE_MAX_BYTES,
      20 * 1024 * 1024,
      1024,
      100 * 1024 * 1024,
      "CHATGPT_IMAGE_MAX_BYTES",
    ),
    maxImages: parseInteger(env.CHATGPT_IMAGE_MAX_COUNT, 4, 1, 8, "CHATGPT_IMAGE_MAX_COUNT"),
    maxSourceBytes: parseInteger(
      env.CHATGPT_SOURCE_IMAGE_MAX_BYTES,
      25 * 1024 * 1024,
      1024,
      100 * 1024 * 1024,
      "CHATGPT_SOURCE_IMAGE_MAX_BYTES",
    ),
    profileLeaseTimeoutMs: parseInteger(
      env.CHATGPT_BROWSER_PROFILE_LEASE_TIMEOUT_MS,
      15000,
      1000,
      120000,
      "CHATGPT_BROWSER_PROFILE_LEASE_TIMEOUT_MS",
    ),
    outputDir: path.resolve(
      expandHome(env.CHATGPT_IMAGE_OUTPUT_DIR || path.join(root, "outputs"), homeDir),
    ),
    localSettings,
    projectName:
      String(env.CHATGPT_PROJECT_NAME || localSettings.project_name || "ChatGPT Web Image MCP").trim(),
    projectUrl,
    settingsFile,
    styleProfile: normalizeProfile(
      env.CHATGPT_STYLE_PROFILE ?? localSettings.style_profile,
      "CHATGPT_STYLE_PROFILE",
    ),
    surface,
    timeoutMs: parseInteger(
      env.CHATGPT_IMAGE_TIMEOUT_MS,
      540000,
      30000,
      1800000,
      "CHATGPT_IMAGE_TIMEOUT_MS",
    ),
  };
}
