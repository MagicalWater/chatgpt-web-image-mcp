import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalized(value) {
  return String(value).replaceAll('"', "").toLowerCase();
}

export function processLineUsesDedicatedChromeProfile(line, profilePath, platform = process.platform) {
  const resolvedProfile = path.resolve(profilePath);
  const normalizedLine = normalized(line);
  const userDataMarker = normalized(`--user-data-dir=${resolvedProfile}`);
  if (!normalizedLine.includes(userDataMarker)) {
    return false;
  }
  if (platform === "win32") {
    return normalizedLine.includes("chrome.exe");
  }
  if (platform === "darwin") {
    return normalizedLine.includes("/applications/google chrome.app/contents/");
  }
  return /(?:^|[\s/])(google-chrome|chromium)(?:[\s/]|$)/i.test(normalizedLine);
}

export async function isDedicatedChromeProfileRunning(
  profilePath,
  { platform = process.platform, execFileImpl = execFileAsync } = {},
) {
  let stdout;
  if (platform === "win32") {
    const script = "Get-CimInstance Win32_Process -Filter \"Name = 'chrome.exe'\" | ForEach-Object { \"$($_.ProcessId)\t$($_.CommandLine)\" }";
    ({ stdout } = await execFileImpl("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" }));
  } else {
    ({ stdout } = await execFileImpl("ps", ["-axo", "pid=,command="], { encoding: "utf8" }));
  }
  return String(stdout || "")
    .split(/\r?\n/)
    .some((line) => processLineUsesDedicatedChromeProfile(line, profilePath, platform));
}
