import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./ed25519.js";
import { providerPythonDebuggerRuntime } from "./python-debugger-provider-runtime.js";
import {
  runPythonToolchainCommand,
  type ToolchainOptions,
} from "./python-toolchain.js";

export interface PythonDebuggerRuntime {
  location: "host" | "provider";
  sandbox: string;
  isolation: "none" | "oci";
  executable: string;
  executableSha256: string;
  debugpyRoot: string;
  debugpyVersion: string;
  pythonVersion: string;
  packageSha256: string;
  environmentConfigPath?: string;
  environmentConfigSha256?: string;
  protocolWorkspaceRoot?: string;
  identitySha256: string;
}

/** Debugpy uses internal TCP. An isolated provider must bind that transport
 * explicitly; never relax an offline sandbox or silently select host execution. */
export async function resolvePythonDebuggerRuntime(
  options: ToolchainOptions,
  signal?: AbortSignal,
): Promise<PythonDebuggerRuntime> {
  if (signal?.aborted)
    throw new Error("Python debugger runtime probe was cancelled");
  const provider = await providerPythonDebuggerRuntime(options);
  if (provider) return provider;
  if (options.sandbox.id !== "host-direct")
    throw new Error(
      "Python debugger requires an explicitly selected host-direct provider; isolated debug transport is not configured",
    );
  const result = await runPythonToolchainCommand(
    options,
    {
      runtime: "python",
      cwd: ".",
      timeoutMs: 10000,
      args: [
        "-I",
        "-B",
        "-c",
        "import json,sys,os,debugpy;print(json.dumps(dict(executable=sys.executable,debugpyRoot=os.path.dirname(debugpy.__file__),debugpyVersion=debugpy.__version__,pythonVersion=sys.version.split()[0])))",
      ],
    },
    signal,
  );
  if (
    result.details.status !== "succeeded" ||
    result.details.stdoutTruncated ||
    result.details.stderrTruncated
  )
    throw new Error(
      "Python debugger runtime probe failed; install debugpy in the selected Python environment",
    );
  const probe = JSON.parse(result.stdout) as Record<string, unknown>;
  if (
    !["executable", "debugpyRoot", "debugpyVersion", "pythonVersion"].every(
      (key) => typeof probe[key] === "string",
    ) ||
    !path.isAbsolute(String(probe.executable)) ||
    !path.isAbsolute(String(probe.debugpyRoot))
  )
    throw new Error(
      "Python debugger runtime probe returned an invalid identity",
    );
  const environmentConfigPath = path.resolve(
    String(probe.executable),
    "../..",
    "pyvenv.cfg",
  );
  const content = {
    location: "host" as const,
    sandbox: options.sandbox.id,
    isolation: "none" as const,
    executable: String(probe.executable),
    executableSha256: result.details.executableSha256,
    debugpyRoot: await realpath(String(probe.debugpyRoot)),
    debugpyVersion: String(probe.debugpyVersion),
    pythonVersion: String(probe.pythonVersion),
    packageSha256: await debuggerPackageHash(String(probe.debugpyRoot)),
    environmentConfigPath,
    environmentConfigSha256: await environmentConfigHash(environmentConfigPath),
  };
  return { ...content, identitySha256: sha256(canonicalJson(content)) };
}

export async function assertPythonDebuggerRuntimeCurrent(
  runtime: PythonDebuggerRuntime,
  options?: ToolchainOptions,
): Promise<void> {
  if (runtime.location === "provider") {
    const current = options
      ? await providerPythonDebuggerRuntime(options)
      : undefined;
    if (!current || current.identitySha256 !== runtime.identitySha256)
      throw new Error(
        "Python debugger provider runtime changed during the session",
      );
    return;
  }
  if (!runtime.environmentConfigPath || !runtime.environmentConfigSha256)
    throw new Error("Python debugger environment identity is missing");
  if (
    sha256(await readFile(runtime.executable)) !== runtime.executableSha256 ||
    (await environmentConfigHash(runtime.environmentConfigPath)) !==
      runtime.environmentConfigSha256 ||
    (await debuggerPackageHash(runtime.debugpyRoot)) !== runtime.packageSha256
  )
    throw new Error("Python debugger runtime changed during the session");
}

async function debuggerPackageHash(root: string): Promise<string> {
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("Python debugger package root contains a symlink");
  const entries: Array<[string, string]> = [];
  let bytes = 0;
  async function visit(relative: string): Promise<void> {
    const directory = path.join(root, relative);
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      const file = path.join(root, name);
      if (entry.isSymbolicLink())
        throw new Error("Python debugger package contains a symlink");
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        if (
          entries.length >= 2048 ||
          (bytes += (await lstat(file)).size) > 64 * 1024 * 1024
        )
          throw new Error(
            "Python debugger package identity exceeds its bounds",
          );
        entries.push([name, sha256(await readFile(file))]);
      } else
        throw new Error("Python debugger package contains a non-file asset");
    }
  }
  await visit("");
  if (entries.length === 0) throw new Error("Python debugger package is empty");
  return sha256(canonicalJson(entries));
}

async function environmentConfigHash(file: string): Promise<string> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 16384)
      throw new Error("Python debugger environment configuration is invalid");
    return sha256(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return sha256("absent");
    throw error;
  }
}
