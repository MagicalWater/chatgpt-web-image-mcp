import path from "node:path";
import { spawn as spawnChild } from "node:child_process";

import { validateChatGPTUrl } from "./config.js";
import { UserFacingError } from "./errors.js";

function windowsChromeCandidates(env) {
  return [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] &&
      path.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
}

export function resolveNativeChromeExecutable({
  platform = process.platform,
  env = process.env,
  chromeExecutable,
} = {}) {
  if (chromeExecutable) {
    return chromeExecutable;
  }
  if (env.CHATGPT_CHROME_EXECUTABLE) {
    return env.CHATGPT_CHROME_EXECUTABLE;
  }
  if (platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  if (platform === "win32") {
    return windowsChromeCandidates(env)[0] || "chrome.exe";
  }
  return "google-chrome";
}

export function buildNativeChromeLaunch({
  platform = process.platform,
  env = process.env,
  chromeExecutable,
  chromeUserDataDir,
  chatgptUrl,
}) {
  const validatedUrl = validateChatGPTUrl(chatgptUrl);
  const platformArgs = platform === "darwin" ? ["--password-store=basic", "--use-mock-keychain"] : [];
  return {
    command: resolveNativeChromeExecutable({ platform, env, chromeExecutable }),
    args: [`--user-data-dir=${chromeUserDataDir}`, ...platformArgs, "--new-window", validatedUrl],
  };
}

export async function launchNativeChromeForLogin(input, dependencies = {}) {
  const spawn = dependencies.spawn || spawnChild;
  const launch = buildNativeChromeLaunch(input);

  await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(launch.command, launch.args, { stdio: "ignore" });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(
        new UserFacingError(
          "Google Chrome could not be started for the dedicated login profile.",
          "CHROME_NOT_FOUND",
          { cause: error },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new UserFacingError(
          `Dedicated Chrome exited before login verification${signal ? ` (${signal})` : ""}.`,
          "BROWSER_START_FAILED",
        ),
      );
    });
  });
}
