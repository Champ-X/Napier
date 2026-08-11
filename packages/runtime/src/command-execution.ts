import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertCommandRuntimeBindingStable,
  resolveCommandRuntimeBinding,
  resolveCommandRuntimeReadPaths,
  shellInvocationArgs,
  type CommandRuntime,
  type CommandRuntimeAsset,
  type CommandRuntimeReadPathIdentity,
} from "./command-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { OCI_PROCESS_RESOURCE_POLICY_SHA256 } from "./sandbox-container-policy.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import {
  runSandboxedProcess,
  type SandboxedProcessResult,
} from "./sandboxed-process.js";
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_COMMAND_ARGUMENTS = 64;
export const MAX_COMMAND_ARGUMENT_CHARS = 2_048;
export const COMMAND_ARGUMENT_PATTERN = "^[^\\u0000-\\u001f\\u007f]*$";
const MAX_TOTAL_ARGUMENT_CHARS = 16_384;
export const MAX_COMMAND_OUTPUT_CHARS = 32_000;
const COMMAND_ARGUMENT_EXPRESSION = new RegExp(COMMAND_ARGUMENT_PATTERN, "u");
export type { CommandRuntime, CommandRuntimeAsset } from "./command-runtime.js";
export { sha256File } from "./command-runtime.js";

export interface CommandExecutionRequest {
  runtime: CommandRuntime;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export type CommandExecutionStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped";

export interface CommandExecutionDetails {
  runtime: CommandRuntime;
  status: CommandExecutionStatus;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  cwdPathSha256: string;
  executablePathSha256: string;
  executableSha256: string;
  argumentCount: number;
  argumentSetSha256: string;
  environmentSha256: string;
  runtimeIdentitySha256?: string;
  runtimeAssetSetSha256?: string;
  runtimeReadPathSetSha256?: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  outputLimitChars: number;
  commandSha256: string;
  resultSha256: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutChars: number;
  stderrChars: number;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface CommandExecutionResult {
  details: CommandExecutionDetails;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  executables?: Partial<Record<CommandRuntime, string>>;
  runtimeReadPaths?: string[];
}

export interface PreparedCommandExecution {
  runtime: CommandRuntime;
  sandboxId: string;
  args: string[];
  workspaceRoot: string;
  cwd: string;
  executable: string;
  executableSha256: string;
  bindingLocation: "host" | "provider";
  runtimeIdentitySha256?: string;
  runtimeAssets: CommandRuntimeAsset[];
  runtimeReadPaths: string[];
  runtimeReadPathIdentities: CommandRuntimeReadPathIdentity[];
  timeoutMs: number;
  launch: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    workspaceRoot: string;
    approvedCapabilities:
      | ["process.spawn", "workspace.read"]
      | ["process.spawn", "workspace.read", "workspace.write"];
    runtimeReadPaths?: string[];
    workspaceWritePaths?: string[];
  };
  receipt: {
    runtime: CommandRuntime;
    cwdPathSha256: string;
    executablePathSha256: string;
    executableSha256: string;
    argumentCount: number;
    argumentSetSha256: string;
    environmentSha256: string;
    runtimeIdentitySha256?: string;
    runtimeAssetSetSha256?: string;
    runtimeReadPathSetSha256?: string;
    resourceLimitsSha256: string;
    timeoutMs: number;
    outputLimitChars: number;
    workspaceAccess: "read_only";
    networkAccess: "denied";
  };
}

const FIXED_ENVIRONMENT = {
  CI: "1",
  FORCE_COLOR: "0",
  LANG: "C",
  LC_ALL: "C",
  NO_COLOR: "1",
} as const;
const FIXED_PYTHON_ENVIRONMENT = {
  ...FIXED_ENVIRONMENT,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONHASHSEED: "0",
  PYTHONNOUSERSITE: "1",
} as const;

export class CommandRunner {
  constructor(private readonly options: CommandRunnerOptions) {}

  async run(
    input: CommandExecutionRequest,
    signal?: AbortSignal,
  ): Promise<CommandExecutionResult> {
    const prepared = await prepareCommandExecution(this.options, input);
    let execution: SandboxedProcessResult;
    try {
      execution = await runSandboxedProcess({
        sandbox: this.options.sandbox,
        launch: prepared.launch,
        timeoutMs: prepared.timeoutMs,
        maxOutputChars: MAX_COMMAND_OUTPUT_CHARS,
        ...(signal ? { signal } : {}),
        abortedMessage: "command execution was aborted",
      });
    } finally {
      await assertCommandRuntimeStable(prepared);
    }
    return finalizeCommandExecution(prepared, execution);
  }
}

export async function prepareCommandExecution(
  options: CommandRunnerOptions,
  input: CommandExecutionRequest,
): Promise<PreparedCommandExecution> {
  validateCommandRequest(input);
  const workspaceRoot = await realpath(path.resolve(options.workspaceRoot));
  const cwd = await resolveWorkspaceDirectory(workspaceRoot, input.cwd ?? ".");
  const cwdPath = path.relative(workspaceRoot, cwd) || ".";
  const providerBinding = await options.sandbox.resolveCommandRuntime?.(
    input.runtime,
  );
  if (providerBinding) {
    validateProviderRuntimeBinding(providerBinding, input.runtime);
    if (options.executables?.[input.runtime] !== undefined) {
      throw new Error(
        "Provider-bound command runtimes do not accept host executable overrides",
      );
    }
  }
  const hostBinding = providerBinding
    ? undefined
    : await resolveCommandRuntimeBinding(input.runtime, options.executables);
  const binding = providerBinding ?? hostBinding!;
  if (providerBinding && (options.runtimeReadPaths?.length ?? 0) > 0) {
    throw new Error(
      "Image-bound command runtimes cannot mount host runtime read paths",
    );
  }
  const runtimeAssets = hostBinding?.runtimeAssets ?? [];
  const runtimeReadPathBinding = await resolveCommandRuntimeReadPaths([
    ...(hostBinding?.runtimeReadPaths ?? []),
    ...(options.runtimeReadPaths ?? []),
  ]);
  const runtimeReadPaths = runtimeReadPathBinding.paths;
  const environment = commandEnvironment(
    input.runtime,
    binding.executableSearchPaths,
    providerBinding !== undefined,
  );
  const launchArgs =
    input.runtime === "shell"
      ? shellInvocationArgs(input.args[0]!)
      : [...input.args];
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const resourceLimits = {
    wallTimeMs: timeoutMs,
    outputCharsPerStream: MAX_COMMAND_OUTPUT_CHARS,
    processGroupTermination: true,
    cpuLimit: "sandbox_backend_default",
    memoryLimit: "sandbox_backend_default",
    runtimeAssetCount: runtimeAssets.length,
    runtimeReadPathCount: runtimeReadPaths.length,
    ...(options.sandbox.id === "oci-container" && {
      sandboxResourcePolicySha256: OCI_PROCESS_RESOURCE_POLICY_SHA256,
    }),
  };
  const receipt = {
    runtime: input.runtime,
    cwdPathSha256: sha256(cwdPath),
    executablePathSha256: sha256(binding.executable),
    executableSha256: binding.executableSha256,
    argumentCount: input.args.length,
    argumentSetSha256: sha256(canonicalJson(input.args)),
    environmentSha256: sha256(canonicalJson(environment)),
    ...(providerBinding
      ? { runtimeIdentitySha256: providerBinding.runtimeIdentitySha256 }
      : {}),
    ...(hostBinding?.runtimeAssetSetSha256
      ? { runtimeAssetSetSha256: hostBinding.runtimeAssetSetSha256 }
      : {}),
    ...(runtimeReadPaths.length > 0
      ? {
          runtimeReadPathSetSha256: runtimeReadPathBinding.setSha256,
        }
      : {}),
    resourceLimitsSha256: sha256(canonicalJson(resourceLimits)),
    timeoutMs,
    outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
    workspaceAccess: "read_only" as const,
    networkAccess: "denied" as const,
  };
  if (options.sandbox.id === "oci-container" && !providerBinding) {
    throw new Error(
      "Host-bound command runtimes require a local OS sandbox until container runtime identity binding is available",
    );
  }
  return {
    runtime: input.runtime,
    sandboxId: options.sandbox.id,
    args: [...input.args],
    workspaceRoot,
    cwd,
    executable: binding.executable,
    executableSha256: binding.executableSha256,
    bindingLocation: providerBinding ? "provider" : "host",
    ...(providerBinding
      ? { runtimeIdentitySha256: providerBinding.runtimeIdentitySha256 }
      : {}),
    runtimeAssets,
    runtimeReadPaths,
    runtimeReadPathIdentities: runtimeReadPathBinding.identities,
    timeoutMs,
    launch: {
      command: binding.executable,
      args: launchArgs,
      cwd,
      env: { ...environment },
      workspaceRoot,
      approvedCapabilities: ["process.spawn", "workspace.read"],
      ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
    },
    receipt,
  };
}

export async function assertCommandRuntimeStable(
  prepared: PreparedCommandExecution,
): Promise<void> {
  if (prepared.bindingLocation === "provider") return;
  await assertCommandRuntimeBindingStable(prepared);
}

export function finalizeCommandExecution(
  prepared: PreparedCommandExecution,
  execution: SandboxedProcessResult,
): CommandExecutionResult {
  const status: CommandExecutionStatus =
    execution.status === "exited"
      ? execution.exitCode === 0
        ? "succeeded"
        : "failed"
      : execution.status;
  const stdoutSha256 = sha256(execution.stdout);
  const stderrSha256 = sha256(execution.stderr);
  const resultSha256 = sha256(
    canonicalJson({
      status,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdoutSha256,
      stderrSha256,
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    }),
  );
  return {
    details: {
      runtime: prepared.runtime,
      status,
      sandbox: prepared.sandboxId,
      workspaceAccess: "read_only",
      networkAccess: "denied",
      cwdPathSha256: prepared.receipt.cwdPathSha256,
      executablePathSha256: prepared.receipt.executablePathSha256,
      executableSha256: prepared.executableSha256,
      argumentCount: prepared.receipt.argumentCount,
      argumentSetSha256: prepared.receipt.argumentSetSha256,
      environmentSha256: prepared.receipt.environmentSha256,
      ...(prepared.receipt.runtimeIdentitySha256
        ? {
            runtimeIdentitySha256: prepared.receipt.runtimeIdentitySha256,
          }
        : {}),
      ...(prepared.receipt.runtimeAssetSetSha256
        ? {
            runtimeAssetSetSha256: prepared.receipt.runtimeAssetSetSha256,
          }
        : {}),
      ...(prepared.receipt.runtimeReadPathSetSha256
        ? {
            runtimeReadPathSetSha256: prepared.receipt.runtimeReadPathSetSha256,
          }
        : {}),
      resourceLimitsSha256: prepared.receipt.resourceLimitsSha256,
      timeoutMs: prepared.timeoutMs,
      outputLimitChars: MAX_COMMAND_OUTPUT_CHARS,
      commandSha256: sha256(canonicalJson(prepared.receipt)),
      resultSha256,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      signal: execution.signal,
      stdoutChars: execution.stdout.length,
      stderrChars: execution.stderr.length,
      stdoutSha256,
      stderrSha256,
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    },
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

function validateCommandRequest(input: CommandExecutionRequest): void {
  if (
    input.runtime !== "node" &&
    input.runtime !== "python" &&
    input.runtime !== "shell"
  ) {
    throw new Error(`Unsupported command runtime: ${String(input.runtime)}`);
  }
  if (
    !Array.isArray(input.args) ||
    input.args.length > MAX_COMMAND_ARGUMENTS ||
    input.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length > MAX_COMMAND_ARGUMENT_CHARS ||
        !COMMAND_ARGUMENT_EXPRESSION.test(argument),
    ) ||
    input.args.reduce((total, argument) => total + argument.length, 0) >
      MAX_TOTAL_ARGUMENT_CHARS
  ) {
    throw new Error("command args exceed the bounded explicit argv contract");
  }
  if (input.runtime === "shell" && input.args.length !== 1) {
    throw new Error("shell runtime requires exactly one explicit script");
  }
  if (
    input.cwd !== undefined &&
    (!input.cwd ||
      path.isAbsolute(input.cwd) ||
      input.cwd.length > 500 ||
      !COMMAND_ARGUMENT_EXPRESSION.test(input.cwd))
  ) {
    throw new Error("command cwd must be workspace-relative");
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < MIN_COMMAND_TIMEOUT_MS ||
      input.timeoutMs > MAX_COMMAND_TIMEOUT_MS)
  ) {
    throw new Error(
      `command timeoutMs must be ${MIN_COMMAND_TIMEOUT_MS}-${MAX_COMMAND_TIMEOUT_MS}`,
    );
  }
}

function validateProviderRuntimeBinding(
  binding: {
    runtime: string;
    executable: string;
    executableSha256: string;
    executableSearchPaths?: string[];
    runtimeIdentitySha256: string;
  },
  runtime: CommandRuntime,
): void {
  if (
    binding.runtime !== runtime ||
    !path.posix.isAbsolute(binding.executable) ||
    !/^[a-f0-9]{64}$/u.test(binding.executableSha256) ||
    !/^[a-f0-9]{64}$/u.test(binding.runtimeIdentitySha256) ||
    (runtime === "shell" &&
      (!binding.executableSearchPaths ||
        binding.executableSearchPaths.length === 0 ||
        binding.executableSearchPaths.length > 8 ||
        binding.executableSearchPaths.some(
          (candidate) =>
            !path.posix.isAbsolute(candidate) ||
            /[\u0000-\u001f\u007f]/u.test(candidate),
        )))
  ) {
    throw new Error("Provider command runtime identity is invalid");
  }
}

function commandEnvironment(
  runtime: CommandRuntime,
  executableSearchPaths: readonly string[] | undefined,
  providerBound: boolean,
): Record<string, string> {
  if (runtime === "python") return { ...FIXED_PYTHON_ENVIRONMENT };
  if (runtime === "shell") {
    if (!executableSearchPaths || executableSearchPaths.length === 0) {
      throw new Error("Shell runtime search paths are unavailable");
    }
    return {
      ...FIXED_ENVIRONMENT,
      PATH: executableSearchPaths.join(
        providerBound ? path.posix.delimiter : path.delimiter,
      ),
    };
  }
  return { ...FIXED_ENVIRONMENT };
}

async function resolveWorkspaceDirectory(
  workspaceRoot: string,
  candidate: string,
): Promise<string> {
  const lexical = path.resolve(workspaceRoot, candidate);
  if (!isPathInside(lexical, workspaceRoot)) {
    throw new Error("command cwd escapes the workspace");
  }
  let resolved: string;
  try {
    resolved = await realpath(lexical);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new Error(`command cwd does not exist: ${candidate}`);
    }
    throw error;
  }
  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error("command cwd resolves outside the workspace");
  }
  if (!(await stat(resolved)).isDirectory()) {
    throw new Error("command cwd must be a directory");
  }
  return resolved;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
