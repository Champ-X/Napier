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
const MAX_GIT_SWITCH_STDIN_BYTES = 4 * 1024;
const MAX_GIT_STAGE_STDIN_BYTES = 128 * 1024;
export const MAX_GIT_PROCESS_OUTPUT_CHARS = 128 * 1024;
const GIT_ARGUMENT_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const GIT_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
  PAGER: "cat",
} as const;
export const GIT_COMMIT_IDENTITY = {
  name: "Napier Agent",
  email: "napier@localhost",
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

export interface GitPrivateProcessFiles {
  indexFile: string;
  objectDirectory: string;
  alternateObjectDirectory: string;
}

export interface GitProcessIsolation {
  operation?: "stage" | "commit" | "branch" | "switch";
  privateFiles?: GitPrivateProcessFiles;
  workspaceWritePaths: string[];
  commitTimestampSeconds?: number;
  stdin?: string;
}

export async function runGitInspectProcess(
  options: GitInspectProcessOptions,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<GitInspectProcessResult> {
  return runGitProcess(options, args, timeoutMs, signal);
}

export async function runGitProcess(
  options: GitInspectProcessOptions,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
  isolation?: GitProcessIsolation,
): Promise<GitInspectProcessResult> {
  validateGitArguments(args);
  validateGitStdin(isolation);
  const operation = isolation
    ? isolation.operation === "commit"
      ? "Git commit"
      : isolation.operation === "branch"
        ? "Git branch creation"
        : isolation.operation === "switch"
          ? "Git branch switch"
          : "Git stage preparation"
    : "Git inspection";
  if (options.sandbox.id === "oci-container") {
    throw new Error(
      `${operation} requires a local OS sandbox until container runtime identity binding is available`,
    );
  }
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const privateEnvironment = isolation?.privateFiles
    ? validatePrivateProcessFiles(isolation.privateFiles, workspaceRoot)
    : {};
  const commitEnvironment =
    isolation?.commitTimestampSeconds !== undefined
      ? commitIdentityEnvironment(isolation.commitTimestampSeconds)
      : {};
  const environment = {
    ...GIT_ENVIRONMENT,
    ...privateEnvironment,
    ...commitEnvironment,
  };
  const approvedCapabilities = isolation
    ? (["process.spawn", "workspace.read", "workspace.write"] as const)
    : (["process.spawn", "workspace.read"] as const);
  const executable = await resolveGitExecutable(options.gitExecutable);
  const executableSha256 = await sha256File(executable);
  const resourceLimits = {
    wallTimeMs: timeoutMs,
    outputCharsPerStream: MAX_GIT_PROCESS_OUTPUT_CHARS,
    processGroupTermination: true,
    cpuLimit: "sandbox_backend_default",
    memoryLimit: "sandbox_backend_default",
    approvedCapabilities,
    workspaceWritePathSha256: (isolation?.workspaceWritePaths ?? []).map(
      (value) => sha256(path.resolve(value)),
    ),
    ...(isolation?.stdin !== undefined
      ? {
          stdinBytes: Buffer.byteLength(isolation.stdin, "utf8"),
          stdinSha256: sha256(isolation.stdin),
        }
      : {}),
  };
  let execution;
  try {
    execution = await runSandboxedProcess({
      sandbox: options.sandbox,
      launch: {
        command: executable,
        args: [...args],
        cwd: workspaceRoot,
        env: environment,
        workspaceRoot,
        approvedCapabilities: [...approvedCapabilities],
        ...(isolation
          ? { workspaceWritePaths: isolation.workspaceWritePaths }
          : {}),
      },
      timeoutMs,
      maxOutputChars: MAX_GIT_PROCESS_OUTPUT_CHARS,
      ...(isolation?.stdin !== undefined ? { stdin: isolation.stdin } : {}),
      ...(signal ? { signal } : {}),
      abortedMessage: `${operation} was aborted`,
    });
  } finally {
    if ((await sha256File(executable).catch(() => "")) !== executableSha256) {
      throw new Error(
        `Git executable changed during ${operation.toLowerCase()}`,
      );
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
    environmentSha256: sha256(canonicalJson(environment)),
    resourceLimitsSha256: sha256(canonicalJson(resourceLimits)),
  };
}

function validateGitStdin(isolation: GitProcessIsolation | undefined): void {
  if (isolation?.stdin === undefined) return;
  const bytes = Buffer.byteLength(isolation.stdin, "utf8");
  const validSwitch =
    isolation.operation === "switch" &&
    bytes <= MAX_GIT_SWITCH_STDIN_BYTES &&
    !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(isolation.stdin);
  const validStage =
    isolation.operation === "stage" &&
    bytes <= MAX_GIT_STAGE_STDIN_BYTES &&
    !isolation.stdin.includes("\u0000");
  if (!validSwitch && !validStage)
    throw new Error("Git standard input is invalid");
}

function commitIdentityEnvironment(
  timestampSeconds: number,
): Record<string, string> {
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < 0 ||
    timestampSeconds > 9_999_999_999
  ) {
    throw new Error("Git commit timestamp is invalid");
  }
  const date = `${timestampSeconds} +0000`;
  return {
    GIT_AUTHOR_NAME: GIT_COMMIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: GIT_COMMIT_IDENTITY.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: GIT_COMMIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: GIT_COMMIT_IDENTITY.email,
    GIT_COMMITTER_DATE: date,
  };
}

function validatePrivateProcessFiles(
  files: GitPrivateProcessFiles,
  workspaceRoot: string,
): Record<string, string> {
  const values = [
    files.indexFile,
    files.objectDirectory,
    files.alternateObjectDirectory,
  ];
  if (
    values.some(
      (value) =>
        !path.isAbsolute(value) ||
        !isPathInside(value, workspaceRoot) ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  ) {
    throw new Error("Git private process paths are invalid");
  }
  return {
    GIT_INDEX_FILE: path.resolve(files.indexFile),
    GIT_OBJECT_DIRECTORY: path.resolve(files.objectDirectory),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.resolve(
      files.alternateObjectDirectory,
    ),
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
    throw new Error("Git arguments are invalid");
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}
