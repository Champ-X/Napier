import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { sha256File } from "./command-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { runSandboxedProcess } from "./sandboxed-process.js";

const DEFAULT_GIT_EXECUTABLE = "/usr/bin/git";
const MAX_GIT_ARGUMENTS = 32;
const MAX_GIT_ARGUMENT_CHARS = 2_048;
const MAX_GIT_TOTAL_ARGUMENT_CHARS = 16_384;
export const MAX_GIT_PROCESS_OUTPUT_CHARS = 128 * 1024;
const GIT_ARGUMENT_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const GIT_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
  PAGER: "cat",
} as const;

export interface GitInspectProcessOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  gitExecutable?: string;
}

export interface GitInspectProcessResult {
  stdout: string;
  stderr: string;
  status: "succeeded" | "failed" | "timed_out" | "output_capped";
  exitCode: number | null;
  durationMs: number;
  sandboxSha256: string;
  executableSha256: string;
  argumentSetSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
}

export async function runGitInspectProcess(
  options: GitInspectProcessOptions,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GitInspectProcessResult> {
  validateGitArguments(args);
  if (options.sandbox.id === "oci-container") {
    throw new Error(
      "Git inspection requires a local OS sandbox until container runtime identity binding is available",
    );
  }
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const executable = await resolveGitExecutable(options.gitExecutable);
  const executableSha256 = await sha256File(executable);
  const resourceLimits = {
    wallTimeMs: timeoutMs,
    outputCharsPerStream: MAX_GIT_PROCESS_OUTPUT_CHARS,
    processGroupTermination: true,
    cpuLimit: "sandbox_backend_default",
    memoryLimit: "sandbox_backend_default",
  };
  let execution;
  try {
    execution = await runSandboxedProcess({
      sandbox: options.sandbox,
      launch: {
        command: executable,
        args: [...args],
        cwd: workspaceRoot,
        env: { ...GIT_ENVIRONMENT },
        workspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      timeoutMs,
      maxOutputChars: MAX_GIT_PROCESS_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "Git inspection was aborted",
    });
  } finally {
    if ((await sha256File(executable).catch(() => "")) !== executableSha256) {
      throw new Error("Git executable changed during inspection");
    }
  }
  const status =
    execution.status === "exited"
      ? execution.exitCode === 0
        ? ("succeeded" as const)
        : ("failed" as const)
      : execution.status;
  return {
    stdout: execution.stdout,
    stderr: execution.stderr,
    status,
    exitCode: execution.exitCode,
    durationMs: execution.durationMs,
    sandboxSha256: sha256(options.sandbox.id),
    executableSha256,
    argumentSetSha256: sha256(canonicalJson(args)),
    environmentSha256: sha256(canonicalJson(GIT_ENVIRONMENT)),
    resourceLimitsSha256: sha256(canonicalJson(resourceLimits)),
  };
}

async function resolveGitExecutable(
  override: string | undefined,
): Promise<string> {
  const candidate = override ?? DEFAULT_GIT_EXECUTABLE;
  if (!path.isAbsolute(candidate)) {
    throw new Error("Git executable must use an absolute path");
  }
  try {
    await access(candidate, fsConstants.X_OK);
    const resolved = await realpath(candidate);
    if (!(await stat(resolved)).isFile()) throw new Error();
    return resolved;
  } catch {
    throw new Error("Git runtime is unavailable");
  }
}

function validateGitArguments(args: string[]): void {
  if (
    !Array.isArray(args) ||
    args.length < 1 ||
    args.length > MAX_GIT_ARGUMENTS ||
    args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length > MAX_GIT_ARGUMENT_CHARS ||
        !GIT_ARGUMENT_PATTERN.test(argument),
    ) ||
    args.reduce((total, argument) => total + argument.length, 0) >
      MAX_GIT_TOTAL_ARGUMENT_CHARS
  ) {
    throw new Error("Git inspection arguments are invalid");
  }
}
