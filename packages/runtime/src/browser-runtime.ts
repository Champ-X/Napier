import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { chromium, type LaunchOptions } from "playwright-core";

import type { BrowserRuntimeBinding } from "./browser-session-model.js";
import {
  BROWSER_LAUNCH_TIMEOUT_MS,
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
} from "./browser-session-model.js";
import { sha256File } from "./command-execution.js";
import type { FixedIpProxyBinding } from "./fixed-ip-http-proxy.js";
import { verifiedPinnedBrowserRuntimeCandidate } from "./browser-runtime-verification.js";

const ALLOWED_EXECUTABLE_NAMES = new Set([
  "chrome",
  "chrome.exe",
  "chromium",
  "chromium-browser",
  "google chrome",
  "google chrome for testing",
  "google-chrome",
  "microsoft edge",
  "msedge",
  "msedge.exe",
]);

export async function resolveBrowserRuntime(
  configuredPath?: string,
): Promise<BrowserRuntimeBinding> {
  const candidates = configuredPath
    ? [configuredPath]
    : await browserExecutableCandidates();
  for (const candidate of candidates) {
    try {
      const executablePath = await realpath(path.resolve(candidate));
      const info = await lstat(executablePath);
      const name = path.basename(executablePath).toLowerCase();
      if (
        !info.isFile() ||
        !ALLOWED_EXECUTABLE_NAMES.has(name) ||
        info.size <= 0
      ) {
        continue;
      }
      await access(executablePath, fsConstants.X_OK);
      return {
        executablePath,
        executableSha256: await sha256File(executablePath),
        identity: {
          device: info.dev,
          inode: info.ino,
          size: info.size,
          modifiedAtMs: info.mtimeMs,
        },
      };
    } catch {
      // Continue through the fixed browser executable allowlist.
    }
  }
  throw new Error(
    "No supported Chrome, Chromium, or Edge executable is available",
  );
}

export async function assertBrowserRuntimeCurrent(
  runtime: BrowserRuntimeBinding,
): Promise<void> {
  if (!runtime.identity) return;
  const [canonicalPath, info] = await Promise.all([
    realpath(runtime.executablePath),
    lstat(runtime.executablePath),
  ]).catch(() => {
    throw new Error("Browser executable changed before Session launch");
  });
  if (
    canonicalPath !== runtime.executablePath ||
    !info.isFile() ||
    info.dev !== runtime.identity.device ||
    info.ino !== runtime.identity.inode ||
    info.size !== runtime.identity.size ||
    info.mtimeMs !== runtime.identity.modifiedAtMs
  ) {
    throw new Error("Browser executable changed before Session launch");
  }
}

export function browserLaunchOptions(
  runtime: BrowserRuntimeBinding,
  proxy: FixedIpProxyBinding,
  runtimeRoot: string,
): LaunchOptions {
  return {
    executablePath: runtime.executablePath,
    headless: true,
    chromiumSandbox: true,
    timeout: BROWSER_LAUNCH_TIMEOUT_MS,
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    artifactsDir: runtimeRoot,
    downloadsPath: path.join(runtimeRoot, "downloads"),
    env: browserEnvironment(runtimeRoot),
    proxy: {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
      bypass: "<-loopback>",
    },
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-crash-reporter",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-quic",
      "--disable-sync",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  };
}

export function browserContextOptions() {
  return {
    acceptDownloads: true,
    serviceWorkers: "block" as const,
    viewport: {
      width: BROWSER_VIEWPORT_WIDTH,
      height: BROWSER_VIEWPORT_HEIGHT,
    },
    ignoreHTTPSErrors: false,
    permissions: [],
  };
}

function browserEnvironment(
  runtimeRoot: string,
): Record<string, string | undefined> {
  const allowed = ["LANG", "LC_ALL", "PATH"] as const;
  const environment: Record<string, string> = {
    HOME: runtimeRoot,
    TMPDIR: runtimeRoot,
    XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
    XDG_RUNTIME_DIR: runtimeRoot,
  };
  for (const name of allowed) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

async function browserExecutableCandidates(): Promise<string[]> {
  return [
    ...(process.env["NAPIER_BROWSER_EXECUTABLE"]
      ? [process.env["NAPIER_BROWSER_EXECUTABLE"]!]
      : []),
    ...(await pinnedPlaywrightBrowserCandidates()),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
}

async function pinnedPlaywrightBrowserCandidates(): Promise<string[]> {
  try {
    const candidate = await verifiedPinnedBrowserRuntimeCandidate(
      chromium.executablePath(),
    );
    return candidate ? [candidate] : [];
  } catch {
    return [];
  }
}
