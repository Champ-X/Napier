import { canonicalJson, sha256 } from "./ed25519.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  inspectGitConflict,
  type GitConflictEvidence,
  type GitConflictKind,
} from "./git-conflict-inspect.js";
import {
  gitInspectArguments,
  gitInspectionArgumentsSha256,
} from "./git-inspect-arguments.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitInspectProcess,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  MAX_GIT_PATH_CHARS,
  normalizeGitPath,
  resolveGitRepository,
  snapshotGitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import type { OsSandboxAdapter } from "./sandbox.js";

export const DEFAULT_GIT_INSPECT_TIMEOUT_MS = 10_000;
export const MAX_GIT_INSPECT_TIMEOUT_MS = 30_000;
export const MAX_GIT_INSPECT_PATH_CHARS = MAX_GIT_PATH_CHARS;
export const MAX_GIT_DIFF_CONTEXT_LINES = 10;
export const MAX_GIT_INSPECT_OUTPUT_BYTES = MAX_GIT_PROCESS_OUTPUT_CHARS;

export type GitInspectRequest =
  | {
      action: "status";
      timeoutMs?: number;
    }
  | {
      action: "conflict";
      path: string;
      timeoutMs?: number;
    }
  | {
      action: "diff";
      scope: "working" | "staged";
      path?: string;
      contextLines?: number;
      timeoutMs?: number;
    };

export interface GitInspectDetails {
  kind: "napier.git-inspection";
  schemaVersion: 1;
  action: "status" | "diff" | "conflict";
  scope?: "working" | "staged";
  repositoryPathSha256: string;
  gitDirectorySha256: string;
  pathSha256?: string;
  contextLines?: number;
  statusEntryCount: number;
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  deletedLineCount: number;
  conflictKind?: GitConflictKind;
  conflictStageCount?: number;
  basePresent?: boolean;
  oursPresent?: boolean;
  theirsPresent?: boolean;
  worktreePresent?: boolean;
  conflictEvidenceSha256?: string;
  outputSha256: string;
  outputBytes: number;
  repositoryStateSha256: string;
  headStateSha256: string;
  indexSha256: string;
  indexPresent: boolean;
  configSha256: string;
  sandboxSha256: string;
  gitExecutableSha256: string;
  gitArgumentsSha256: string;
  gitEnvironmentSha256: string;
  gitResourceLimitsSha256: string;
  durationMs: number;
  resultSha256: string;
}

export interface GitInspectResult {
  output: string;
  details: GitInspectDetails;
}

export interface GitInspectRunnerOptions {
  workspaceRoot: string;
  sandbox: OsSandboxAdapter;
  gitExecutable?: string;
}

export class GitInspectRunner {
  constructor(private readonly options: GitInspectRunnerOptions) {}

  async inspect(
    request: GitInspectRequest,
    signal?: AbortSignal,
  ): Promise<GitInspectResult> {
    const normalizedRequest = normalizeGitInspectRequest(request);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const before = await snapshotGitRepository(repository);
    const args =
      normalizedRequest.action === "conflict"
        ? undefined
        : gitInspectArguments(repository, normalizedRequest);
    let argumentsSha256 = gitInspectionArgumentsSha256(
      repository,
      normalizedRequest,
    );
    const timeoutMs =
      normalizedRequest.timeoutMs ?? DEFAULT_GIT_INSPECT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let commandDetails: GitInspectProcessResult | undefined;
    let durationMs = 0;
    let output = "";
    let conflictEvidence: GitConflictEvidence | undefined;
    try {
      const config = await assertGitConfigPolicy(
        this.options,
        repository,
        timeoutMs,
        signal,
      );
      durationMs += config.durationMs;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error("Git inspection timed out");
      if (normalizedRequest.action === "conflict") {
        const result = await inspectGitConflict({
          options: this.options,
          repository,
          targetPath: normalizedRequest.path,
          expectedIndexSha256: before.index.sha256,
          deadline,
          ...(signal ? { signal } : {}),
        });
        commandDetails = aggregateGitInspectProcesses(result.processes);
        argumentsSha256 = sha256(
          canonicalJson({
            semanticArgumentsSha256: argumentsSha256,
            executedArgumentSetsSha256: commandDetails.argumentSetSha256,
          }),
        );
        durationMs += result.durationMs;
        output = result.output;
        conflictEvidence = result.evidence;
      } else {
        const result = await runGitInspectProcess(
          this.options,
          args!,
          remainingMs,
          signal,
        );
        commandDetails = result;
        durationMs += result.durationMs;
        output = result.stdout;
        if (result.status === "output_capped") {
          throw new Error("Git inspection output exceeds its bounded limit");
        }
        if (result.status !== "succeeded" || result.stderr.length > 0) {
          throw new Error("Git inspection failed");
        }
      }
      if (Buffer.byteLength(output, "utf8") > MAX_GIT_INSPECT_OUTPUT_BYTES) {
        throw new Error("Git inspection output exceeds its bounded limit");
      }
    } finally {
      const after = await snapshotGitRepository(repository);
      if (after.stateSha256 !== before.stateSha256) {
        throw new Error("Git repository metadata changed during inspection");
      }
    }
    if (!commandDetails) throw new Error("Git inspection did not execute");
    return finalizeGitInspection(
      normalizedRequest,
      before,
      commandDetails,
      argumentsSha256,
      durationMs,
      output,
      conflictEvidence,
    );
  }
}

function finalizeGitInspection(
  request: GitInspectRequest,
  state: GitRepositoryState,
  command: GitInspectProcessResult,
  argumentsSha256: string,
  durationMs: number,
  output: string,
  conflictEvidence?: GitConflictEvidence,
): GitInspectResult {
  const counts = inspectGitOutput(request.action, output);
  const outputSha256 = sha256(output);
  const core = {
    kind: "napier.git-inspection" as const,
    schemaVersion: 1 as const,
    action: request.action,
    ...(request.action === "diff" ? { scope: request.scope } : {}),
    repositoryPathSha256: sha256("."),
    gitDirectorySha256: sha256(".git"),
    ...((request.action === "diff" || request.action === "conflict") &&
    request.path
      ? { pathSha256: sha256(request.path) }
      : {}),
    ...(request.action === "diff"
      ? { contextLines: request.contextLines ?? 3 }
      : {}),
    ...counts,
    ...(conflictEvidence ?? {}),
    outputSha256,
    outputBytes: Buffer.byteLength(output, "utf8"),
    repositoryStateSha256: state.stateSha256,
    headStateSha256: state.headStateSha256,
    indexSha256: state.index.sha256,
    indexPresent: state.index.present,
    configSha256: state.config.sha256,
    sandboxSha256: command.sandboxSha256,
    gitExecutableSha256: command.executableSha256,
    gitArgumentsSha256: argumentsSha256,
    gitEnvironmentSha256: command.environmentSha256,
    gitResourceLimitsSha256: command.resourceLimitsSha256,
    durationMs,
  };
  return {
    output,
    details: {
      ...core,
      resultSha256: sha256(canonicalJson(core)),
    },
  };
}

function inspectGitOutput(
  action: GitInspectRequest["action"],
  output: string,
): Pick<
  GitInspectDetails,
  | "statusEntryCount"
  | "fileCount"
  | "hunkCount"
  | "addedLineCount"
  | "deletedLineCount"
> {
  const lines = output.split("\n");
  if (action === "status") {
    return {
      statusEntryCount: lines.filter((line) =>
        /^(?:1 |2 |u |\? |! )/u.test(line),
      ).length,
      fileCount: 0,
      hunkCount: 0,
      addedLineCount: 0,
      deletedLineCount: 0,
    };
  }
  if (action === "conflict") {
    return {
      statusEntryCount: 0,
      fileCount: 1,
      hunkCount: 0,
      addedLineCount: 0,
      deletedLineCount: 0,
    };
  }
  return {
    statusEntryCount: 0,
    fileCount: lines.filter((line) => line.startsWith("diff --git ")).length,
    hunkCount: lines.filter((line) => line.startsWith("@@ ")).length,
    addedLineCount: lines.filter(
      (line) => line.startsWith("+") && !line.startsWith("+++"),
    ).length,
    deletedLineCount: lines.filter(
      (line) => line.startsWith("-") && !line.startsWith("---"),
    ).length,
  };
}

function normalizeGitInspectRequest(
  request: GitInspectRequest,
): GitInspectRequest {
  if (
    request.action !== "status" &&
    request.action !== "diff" &&
    request.action !== "conflict"
  ) {
    throw new Error("Git inspection action is invalid");
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isSafeInteger(request.timeoutMs) ||
      request.timeoutMs < 1_000 ||
      request.timeoutMs > MAX_GIT_INSPECT_TIMEOUT_MS)
  ) {
    throw new Error("Git inspection timeout is invalid");
  }
  if (request.action === "status") return { ...request };
  if (request.action === "conflict") {
    return { ...request, path: normalizeGitPath(request.path) };
  }
  if (request.scope !== "working" && request.scope !== "staged") {
    throw new Error("Git diff scope is invalid");
  }
  if (
    request.contextLines !== undefined &&
    (!Number.isSafeInteger(request.contextLines) ||
      request.contextLines < 0 ||
      request.contextLines > MAX_GIT_DIFF_CONTEXT_LINES)
  ) {
    throw new Error("Git diff context is invalid");
  }
  return {
    ...request,
    ...(request.path !== undefined
      ? { path: normalizeGitPath(request.path) }
      : {}),
  };
}

function aggregateGitInspectProcesses(
  processes: GitInspectProcessResult[],
): GitInspectProcessResult {
  const first = processes[0];
  if (
    !first ||
    processes.some(
      (process) =>
        process.status !== "succeeded" ||
        process.stderr.length > 0 ||
        process.sandboxSha256 !== first.sandboxSha256 ||
        process.executableSha256 !== first.executableSha256 ||
        process.environmentSha256 !== first.environmentSha256,
    )
  ) {
    throw new Error("Git conflict process evidence is inconsistent");
  }
  return {
    ...first,
    stdout: "",
    durationMs: Math.max(...processes.map((process) => process.durationMs)),
    argumentSetSha256: sha256(
      canonicalJson(processes.map((process) => process.argumentSetSha256)),
    ),
    resourceLimitsSha256: sha256(
      canonicalJson(processes.map((process) => process.resourceLimitsSha256)),
    ),
  };
}
