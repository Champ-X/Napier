import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

export const BROWSER_USE_LOCAL_PACKAGE = "browser-use";
export const BROWSER_USE_LOCAL_VERSION = "0.13.7";
export const BROWSER_USE_LOCAL_REQUIREMENT = `${BROWSER_USE_LOCAL_PACKAGE}[core]==${BROWSER_USE_LOCAL_VERSION}`;

const PROCESS_OUTPUT_LIMIT_BYTES = 128 * 1024;

export interface BrowserUseLocalInspection {
  backend: "browser_use_local";
  packageName: typeof BROWSER_USE_LOCAL_PACKAGE;
  packageVersion: typeof BROWSER_USE_LOCAL_VERSION;
  pythonVersion: "3.12";
  platform: NodeJS.Platform;
  arch: string;
  status: "ready" | "installable" | "unsupported";
  pythonExecutable?: string;
  browserExecutablePath?: string;
  browserProduct?: BrowserUseLocalBrowserProduct;
  browserVersion?: string;
  uvExecutable?: string;
  diagnosticSha256?: string;
}

export type BrowserUseLocalBrowserProduct = "system_chrome" | "system_chromium";

export interface BrowserUseLocalSetupDependencies {
  uvExecutable?: string;
  runProcess?: (
    request: BrowserUseLocalProcessRequest,
  ) => Promise<BrowserUseLocalProcessResult>;
}

export interface BrowserUseLocalProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
}

export interface BrowserUseLocalProcessResult {
  exitCode: number;
  stdout: string;
  outputBytes: number;
  outputSha256: string;
}

export function browserUseLocalRuntimeRoot(dataRoot: string): string {
  return path.join(
    path.resolve(dataRoot),
    "runtimes",
    "browser-use-local",
    BROWSER_USE_LOCAL_VERSION,
  );
}

export function browserUseLocalPythonExecutable(runtimeRoot: string): string {
  return process.platform === "win32"
    ? path.join(runtimeRoot, ".venv", "Scripts", "python.exe")
    : path.join(runtimeRoot, ".venv", "bin", "python");
}

export async function inspectBrowserUseLocalRuntime(
  dataRoot: string,
  dependencies: BrowserUseLocalSetupDependencies = {},
): Promise<BrowserUseLocalInspection> {
  const base = inspectionBase();
  if (!supportedPlatform()) return { ...base, status: "unsupported" };
  const runProcess = dependencies.runProcess ?? runBrowserUseLocalProcess;
  const runtimeRoot = browserUseLocalRuntimeRoot(dataRoot);
  const pythonExecutable = browserUseLocalPythonExecutable(runtimeRoot);
  const ready = await inspectInstalledRuntime(pythonExecutable, runProcess);
  if (ready) {
    const browser = await inspectSystemBrowser(runProcess);
    if (!browser) {
      return {
        ...base,
        status: "unsupported",
        pythonExecutable: ready,
        diagnosticSha256: createHash("sha256")
          .update("browser_use_local_compatible_browser_missing")
          .digest("hex"),
      };
    }
    return {
      ...base,
      status: "ready",
      pythonExecutable: ready,
      ...browser,
      uvExecutable: dependencies.uvExecutable ?? "uv",
    };
  }
  const uvExecutable = dependencies.uvExecutable ?? "uv";
  const diagnosticSha256 = await inspectUv(uvExecutable, runProcess);
  return diagnosticSha256 === undefined
    ? { ...base, status: "installable", uvExecutable }
    : { ...base, status: "unsupported", diagnosticSha256 };
}

async function inspectSystemBrowser(
  runProcess: (
    request: BrowserUseLocalProcessRequest,
  ) => Promise<BrowserUseLocalProcessResult>,
): Promise<
  | {
      browserExecutablePath: string;
      browserProduct: BrowserUseLocalBrowserProduct;
      browserVersion: string;
    }
  | undefined
> {
  for (const candidate of systemBrowserCandidates()) {
    try {
      const executable = await realpath(candidate.path);
      const info = await stat(executable);
      if (!info.isFile() || info.size <= 0) continue;
      await access(executable, fsConstants.X_OK);
      const result = await runProcess({
        command: executable,
        args: ["--version"],
        cwd: path.dirname(executable),
        env: runtimeInspectionEnvironment(),
        signal: AbortSignal.timeout(5_000),
      });
      const version = /\b([0-9]{2,3}(?:\.[0-9]{1,7}){3})\b/u.exec(
        result.stdout,
      )?.[1];
      if (result.exitCode === 0 && version) {
        return {
          browserExecutablePath: executable,
          browserProduct: candidate.product,
          browserVersion: version,
        };
      }
    } catch {
      // Continue through the fixed system browser allowlist.
    }
  }
  return undefined;
}

function systemBrowserCandidates(): Array<{
  path: string;
  product: BrowserUseLocalBrowserProduct;
}> {
  if (process.platform === "darwin") {
    return [
      {
        path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        product: "system_chrome",
      },
      {
        path: "/Applications/Chromium.app/Contents/MacOS/Chromium",
        product: "system_chromium",
      },
    ];
  }
  if (process.platform === "linux") {
    return [
      ...[
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/local/bin/google-chrome",
        "/opt/google/chrome/chrome",
      ].map((browserPath) => ({
        path: browserPath,
        product: "system_chrome" as const,
      })),
      ...[
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/local/bin/chromium",
      ].map((browserPath) => ({
        path: browserPath,
        product: "system_chromium" as const,
      })),
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LOCALAPPDATA"],
    ].filter((value): value is string => Boolean(value));
    return roots.map((root) => ({
      path: path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      product: "system_chrome" as const,
    }));
  }
  return [];
}

export async function installBrowserUseLocalRuntime(
  input: {
    dataRoot: string;
    env: Readonly<Record<string, string | undefined>>;
    signal: AbortSignal;
  },
  dependencies: BrowserUseLocalSetupDependencies = {},
): Promise<BrowserUseLocalInspection & { status: "ready" }> {
  const before = await inspectBrowserUseLocalRuntime(
    input.dataRoot,
    dependencies,
  );
  if (before.status === "ready") return { ...before, status: "ready" };
  if (before.status !== "installable" || !before.uvExecutable) {
    throw new Error(
      "Browser Use local requires a supported host and the uv package manager",
    );
  }
  input.signal.throwIfAborted();
  const runProcess = dependencies.runProcess ?? runBrowserUseLocalProcess;
  const runtimeRoot = browserUseLocalRuntimeRoot(input.dataRoot);
  const parent = path.dirname(runtimeRoot);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(path.join(parent, ".install-"));
  const stagingPython = browserUseLocalPythonExecutable(stagingRoot);
  const env = installerEnvironment(
    input.env,
    stagingRoot,
    path.join(parent, "managed-python"),
  );
  try {
    const create = await runProcess({
      command: before.uvExecutable,
      args: [
        "venv",
        "--no-project",
        "--managed-python",
        "--python",
        "3.12",
        path.join(stagingRoot, ".venv"),
      ],
      cwd: parent,
      env,
      signal: input.signal,
    });
    assertSetupProcess(create, "Python environment creation");
    const install = await runProcess({
      command: before.uvExecutable,
      args: [
        "pip",
        "install",
        "--python",
        stagingPython,
        "--no-config",
        "--strict",
        BROWSER_USE_LOCAL_REQUIREMENT,
      ],
      cwd: parent,
      env,
      signal: input.signal,
    });
    assertSetupProcess(install, "Browser Use local installation");
    if (!(await inspectInstalledRuntime(stagingPython, runProcess))) {
      throw new Error("Browser Use local verification failed after install");
    }
    try {
      await lstat(runtimeRoot);
      await rename(
        runtimeRoot,
        `${runtimeRoot}.retained-${Date.now().toString(36)}`,
      );
    } catch {
      // The versioned destination does not exist yet.
    }
    await rename(stagingRoot, runtimeRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    if (input.signal.aborted) {
      throw new Error("Browser Use local installation was cancelled");
    }
    throw error;
  }
  const after = await inspectBrowserUseLocalRuntime(
    input.dataRoot,
    dependencies,
  );
  if (after.status !== "ready") {
    throw new Error("Browser Use local runtime is not ready after install");
  }
  return { ...after, status: "ready" };
}

export async function runBrowserUseLocalProcess(
  request: BrowserUseLocalProcessRequest,
): Promise<BrowserUseLocalProcessResult> {
  request.signal.throwIfAborted();
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const collect = (chunk: Buffer, include: boolean): void => {
      outputBytes += chunk.byteLength;
      hash.update(chunk);
      if (include && outputBytes <= PROCESS_OUTPUT_LIMIT_BYTES) {
        stdout.push(chunk);
      }
      if (outputBytes > PROCESS_OUTPUT_LIMIT_BYTES) terminate(child.pid);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    const abort = (): void => terminate(child.pid);
    request.signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) =>
      finish(() => {
        if (request.signal.aborted) {
          reject(new Error("Browser Use local setup process was cancelled"));
          return;
        }
        resolve({
          exitCode: typeof code === "number" ? code : signal ? 128 : 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          outputBytes,
          outputSha256: hash.digest("hex"),
        });
      }),
    );
    function finish(operation: () => void): void {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener("abort", abort);
      operation();
    }
  });
}

async function inspectInstalledRuntime(
  candidate: string,
  runProcess: (
    request: BrowserUseLocalProcessRequest,
  ) => Promise<BrowserUseLocalProcessResult> = runBrowserUseLocalProcess,
): Promise<string | undefined> {
  try {
    const executable = path.resolve(candidate);
    await realpath(executable);
    const info = await stat(executable);
    if (!info.isFile() || info.size <= 0) return undefined;
    await access(executable, fsConstants.X_OK);
    const result = await runProcess({
      // Invoke the venv path rather than its canonical interpreter target so
      // Python activates the managed site-packages beside this executable.
      command: executable,
      args: [
        "-c",
        `import importlib.metadata as m; assert m.version('${BROWSER_USE_LOCAL_PACKAGE}') == '${BROWSER_USE_LOCAL_VERSION}'; from browser_use import Agent, BrowserProfile, Tools; from browser_use.llm import ChatDeepSeek, ChatOpenRouter; print('${BROWSER_USE_LOCAL_VERSION}')`,
      ],
      cwd: path.dirname(executable),
      env: runtimeInspectionEnvironment(),
      signal: AbortSignal.timeout(60_000),
    });
    return result.exitCode === 0 &&
      result.stdout.trim() === BROWSER_USE_LOCAL_VERSION
      ? executable
      : undefined;
  } catch {
    return undefined;
  }
}

async function inspectUv(
  command: string,
  runProcess: (
    request: BrowserUseLocalProcessRequest,
  ) => Promise<BrowserUseLocalProcessResult>,
): Promise<string | undefined> {
  try {
    const result = await runProcess({
      command,
      args: ["--version"],
      cwd: process.cwd(),
      env: runtimeInspectionEnvironment(),
      signal: AbortSignal.timeout(5_000),
    });
    return result.exitCode === 0 &&
      /^uv [0-9]+\.[0-9]+\.[0-9]+/u.test(result.stdout)
      ? undefined
      : result.outputSha256;
  } catch (error) {
    return createHash("sha256").update(String(error)).digest("hex");
  }
}

function inspectionBase(): Omit<BrowserUseLocalInspection, "status"> {
  return {
    backend: "browser_use_local",
    packageName: BROWSER_USE_LOCAL_PACKAGE,
    packageVersion: BROWSER_USE_LOCAL_VERSION,
    pythonVersion: "3.12",
    platform: process.platform,
    arch: process.arch,
  };
}

function supportedPlatform(): boolean {
  if (process.platform === "darwin") {
    return process.arch === "arm64" || process.arch === "x64";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" || process.arch === "x64";
  }
  return process.platform === "win32" && process.arch === "x64";
}

function installerEnvironment(
  input: Readonly<Record<string, string | undefined>>,
  stagingRoot: string,
  pythonInstallRoot: string,
): NodeJS.ProcessEnv {
  const env = runtimeInspectionEnvironment();
  for (const name of [
    "ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
  ]) {
    if (input[name]) env[name] = input[name];
  }
  env["HOME"] = stagingRoot;
  env["UV_NO_CONFIG"] = "1";
  // Keep the managed interpreter outside the transactional venv so uv's
  // absolute venv symlink stays valid when staging is atomically promoted.
  env["UV_PYTHON_INSTALL_DIR"] = pythonInstallRoot;
  return env;
}

function runtimeInspectionEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env["PATH"],
    SYSTEMROOT: process.env["SYSTEMROOT"],
    TMPDIR: process.env["TMPDIR"],
    TEMP: process.env["TEMP"],
    TMP: process.env["TMP"],
    BROWSER_USE_SETUP_LOGGING: "false",
    BROWSER_USE_VERSION_CHECK: "false",
    BROWSER_USE_CLOUD_SYNC: "false",
    ANONYMIZED_TELEMETRY: "false",
  };
}

function assertSetupProcess(
  result: BrowserUseLocalProcessResult,
  label: string,
): void {
  if (result.outputBytes > PROCESS_OUTPUT_LIMIT_BYTES) {
    throw new Error(
      `${label} exceeded its output limit (${result.outputSha256.slice(0, 16)})`,
    );
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed (exit ${String(result.exitCode)}, diagnostic ${result.outputSha256.slice(0, 16)})`,
    );
  }
}

function terminate(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
  } catch {
    // The process already exited.
  }
}
