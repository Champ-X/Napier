import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import type { BrowserRuntimeBinding } from "./browser-session-model.js";
import { resolveBrowserRuntime } from "./browser-runtime.js";
import { verifiedPinnedBrowserRuntimeCandidate } from "./browser-runtime-verification.js";

export { markPinnedBrowserRuntimeVerified } from "./browser-runtime-verification.js";

const INSTALL_OUTPUT_LIMIT_BYTES = 64 * 1024;
const require = createRequire(import.meta.url);

export interface PinnedBrowserRuntimeTarget {
  packageName: "playwright-core";
  packageVersion: string;
  browserName: "chromium";
  browserRevision: string;
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtimeLocationSha256: string;
}

export interface PinnedBrowserRuntimeInspection {
  target: PinnedBrowserRuntimeTarget;
  status: "ready" | "installed" | "installable" | "unsupported";
  runtime?: BrowserRuntimeBinding;
}

export interface BrowserRuntimeInstallerProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface BrowserRuntimeInstallerProcessResult {
  exitCode: number;
  outputBytes: number;
  outputSha256: string;
}

export interface PinnedBrowserRuntimeInstallDependencies {
  inspect?: () => Promise<PinnedBrowserRuntimeInspection>;
  runInstaller?: (
    request: BrowserRuntimeInstallerProcessRequest,
  ) => Promise<BrowserRuntimeInstallerProcessResult>;
}

export async function inspectPinnedBrowserRuntime(): Promise<PinnedBrowserRuntimeInspection> {
  let executablePath: string;
  try {
    executablePath = chromium.executablePath();
  } catch {
    const target = await loadPinnedBrowserRuntimeTarget("");
    return { target, status: "unsupported" };
  }
  const target = await loadPinnedBrowserRuntimeTarget(executablePath);
  try {
    const info = await lstat(executablePath);
    if (!info.isFile()) return { target, status: "unsupported" };
    await access(executablePath, fsConstants.X_OK);
  } catch {
    return { target, status: "installable" };
  }
  try {
    const runtime = await resolveBrowserRuntime(executablePath);
    const verified =
      await verifiedPinnedBrowserRuntimeCandidate(executablePath);
    return {
      target,
      status: verified ? "ready" : "installed",
      runtime,
    };
  } catch {
    return { target, status: "unsupported" };
  }
}

export async function installPinnedBrowserRuntime(
  input: {
    env: Readonly<Record<string, string | undefined>>;
    signal: AbortSignal;
  },
  dependencies: PinnedBrowserRuntimeInstallDependencies = {},
): Promise<PinnedBrowserRuntimeInspection & { status: "ready" | "installed" }> {
  const inspect = dependencies.inspect ?? inspectPinnedBrowserRuntime;
  const before = await inspect();
  if (
    (before.status === "ready" || before.status === "installed") &&
    before.runtime
  ) {
    return before as PinnedBrowserRuntimeInspection & {
      status: "ready" | "installed";
    };
  }
  if (before.status !== "installable") {
    throw new Error("Pinned Browser runtime is unsupported on this host");
  }
  input.signal.throwIfAborted();
  const packageRoot = await playwrightPackageRoot();
  let result: BrowserRuntimeInstallerProcessResult;
  try {
    result = await (dependencies.runInstaller ?? runBrowserRuntimeInstaller)({
      command: process.execPath,
      args: [
        fileURLToPath(
          new URL("./browser-runtime-installer-child.js", import.meta.url),
        ),
      ],
      cwd: packageRoot,
      env: browserInstallerEnvironment(input.env, before),
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) {
      throw new Error("Pinned Browser runtime installation was cancelled");
    }
    throw new Error(
      `Pinned Browser runtime installation failed (diagnostic ${createHash("sha256").update(String(error)).digest("hex").slice(0, 16)})`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `Pinned Browser runtime installation failed (exit ${String(result.exitCode)}, diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
  input.signal.throwIfAborted();
  const after = await inspect();
  if (
    (after.status !== "ready" && after.status !== "installed") ||
    !after.runtime
  ) {
    throw new Error(
      `Pinned Browser runtime verification failed (diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
  if (
    after.target.packageVersion !== before.target.packageVersion ||
    after.target.browserRevision !== before.target.browserRevision ||
    after.target.browserVersion !== before.target.browserVersion ||
    after.target.platform !== before.target.platform ||
    after.target.arch !== before.target.arch ||
    after.target.runtimeLocationSha256 !== before.target.runtimeLocationSha256
  ) {
    throw new Error(
      "Pinned Browser runtime target changed during installation",
    );
  }
  return after as PinnedBrowserRuntimeInspection & {
    status: "ready" | "installed";
  };
}

export async function runBrowserRuntimeInstaller(
  request: BrowserRuntimeInstallerProcessRequest,
): Promise<BrowserRuntimeInstallerProcessResult> {
  request.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const outputHash = createHash("sha256");
    let outputBytes = 0;
    let settled = false;
    let forceTermination: NodeJS.Timeout | undefined;
    let outputLimited = false;
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const collect = (chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      outputHash.update(chunk);
      if (outputBytes > INSTALL_OUTPUT_LIMIT_BYTES && !outputLimited) {
        outputLimited = true;
        terminateProcessGroup(child.pid, "SIGTERM");
        forceTermination = setTimeout(
          () => terminateProcessGroup(child.pid, "SIGKILL"),
          2_000,
        );
        forceTermination.unref();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const abort = (): void => {
      terminateProcessGroup(child.pid, "SIGTERM");
      forceTermination = setTimeout(
        () => terminateProcessGroup(child.pid, "SIGKILL"),
        2_000,
      );
      forceTermination.unref();
    };
    request.signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (forceTermination) clearTimeout(forceTermination);
      request.signal.removeEventListener("abort", abort);
      reject(
        request.signal.aborted
          ? new Error("Pinned Browser runtime installation was cancelled")
          : new Error(
              `Pinned Browser runtime installer could not start (${createHash("sha256").update(String(error)).digest("hex").slice(0, 16)})`,
            ),
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (forceTermination) clearTimeout(forceTermination);
      request.signal.removeEventListener("abort", abort);
      if (request.signal.aborted) {
        reject(new Error("Pinned Browser runtime installation was cancelled"));
        return;
      }
      if (outputLimited) {
        reject(
          new Error(
            `Pinned Browser runtime installer exceeded its output limit (${outputHash.digest("hex").slice(0, 16)})`,
          ),
        );
        return;
      }
      resolve({
        exitCode: typeof code === "number" ? code : signal ? 128 : 1,
        outputBytes,
        outputSha256: outputHash.digest("hex"),
      });
    });
  });
}

async function loadPinnedBrowserRuntimeTarget(
  executablePath: string,
): Promise<PinnedBrowserRuntimeTarget> {
  const packageRoot = await playwrightPackageRoot();
  const [packageValue, browsersValue] = await Promise.all([
    readJson(path.join(packageRoot, "package.json")),
    readJson(path.join(packageRoot, "browsers.json")),
  ]);
  const packageRecord = record(packageValue, "Playwright package metadata");
  if (
    packageRecord["name"] !== "playwright-core" ||
    !version(packageRecord["version"])
  ) {
    throw new Error("Playwright package metadata is invalid");
  }
  const browsersRecord = record(browsersValue, "Playwright Browser metadata");
  if (!Array.isArray(browsersRecord["browsers"])) {
    throw new Error("Playwright Browser metadata is invalid");
  }
  const chromiumRecord = browsersRecord["browsers"]
    .map((value) => record(value, "Playwright Browser entry"))
    .find((value) => value["name"] === "chromium");
  if (
    !chromiumRecord ||
    !digits(chromiumRecord["revision"]) ||
    !version(chromiumRecord["browserVersion"])
  ) {
    throw new Error("Pinned Chromium metadata is invalid");
  }
  return {
    packageName: "playwright-core",
    packageVersion: packageRecord["version"],
    browserName: "chromium",
    browserRevision: chromiumRecord["revision"],
    browserVersion: chromiumRecord["browserVersion"],
    platform: process.platform,
    arch: process.arch,
    runtimeLocationSha256: createHash("sha256")
      .update(path.resolve(executablePath))
      .digest("hex"),
  };
}

async function playwrightPackageRoot(): Promise<string> {
  return path.dirname(
    await realpath(require.resolve("playwright-core/package.json")),
  );
}

async function readJson(filePath: string): Promise<unknown> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.size <= 0 || info.size > 1024 * 1024) {
    throw new Error("Playwright package metadata is invalid");
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function browserInstallerEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  inspection: PinnedBrowserRuntimeInspection,
): NodeJS.ProcessEnv {
  const names = [
    "ALL_PROXY",
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "LOCALAPPDATA",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "PATH",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "XDG_CACHE_HOME",
  ] as const;
  const output: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = input[name]?.trim();
    if (value) output[name] = value;
  }
  output["PLAYWRIGHT_BROWSERS_PATH"] = pinnedBrowserCacheRoot(
    inspection.target,
  );
  output["PLAYWRIGHT_SKIP_BROWSER_GC"] = "1";
  return output;
}

function pinnedBrowserCacheRoot(target: PinnedBrowserRuntimeTarget): string {
  if (target.runtimeLocationSha256 === sha256Path("")) {
    throw new Error("Pinned Browser runtime location is unavailable");
  }
  const executablePath = chromium.executablePath();
  if (sha256Path(executablePath) !== target.runtimeLocationSha256) {
    throw new Error("Pinned Browser runtime location changed before install");
  }
  let current = path.resolve(executablePath);
  const directoryName = `chromium-${target.browserRevision}`;
  for (;;) {
    if (path.basename(current) === directoryName) {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Pinned Browser runtime cache root is invalid");
}

function sha256Path(value: string): string {
  return createHash("sha256").update(path.resolve(value)).digest("hex");
}

function terminateProcessGroup(
  pid: number | undefined,
  signal: NodeJS.Signals,
): void {
  if (!pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal);
  } catch {
    // The installer already exited.
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function digits(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,12}$/u.test(value);
}

function version(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/u.test(value)
  );
}
