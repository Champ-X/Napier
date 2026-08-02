import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  gitConfigKeysPermitInspection,
  gitConfigPolicyArguments,
  gitInspectArguments,
  gitInspectionArgumentsSha256,
} from "./git-inspect-arguments.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitInspectProcess,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const DEFAULT_GIT_INSPECT_TIMEOUT_MS = 10_000;
export const MAX_GIT_INSPECT_TIMEOUT_MS = 30_000;
export const MAX_GIT_INSPECT_PATH_CHARS = 500;
export const MAX_GIT_DIFF_CONTEXT_LINES = 10;
export const MAX_GIT_INSPECT_OUTPUT_BYTES = MAX_GIT_PROCESS_OUTPUT_CHARS;
const MAX_GIT_INDEX_BYTES = 64 * 1024 * 1024;
const MAX_GIT_CONFIG_BYTES = 1024 * 1024;
const MAX_GIT_PACKED_REFS_BYTES = 8 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 16 * 1024;
const GIT_ARGUMENT_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const GIT_REF_PATTERN = /^refs\/(?:heads|tags)\/[^\u0000-\u001f\u007f]{1,500}$/u;
const EMPTY_SHA256 = sha256("");

export type GitInspectRequest =
  | {
      action: "status";
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
  action: "status" | "diff";
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

interface GitRepository {
  root: string;
  gitDirectory: string;
}

interface BoundFile {
  present: boolean;
  sha256: string;
  bytes: number;
}

interface GitRepositoryState {
  stateSha256: string;
  headStateSha256: string;
  index: BoundFile;
  config: BoundFile;
}

export class GitInspectRunner {
  constructor(private readonly options: GitInspectRunnerOptions) {}

  async inspect(
    request: GitInspectRequest,
    signal?: AbortSignal,
  ): Promise<GitInspectResult> {
    validateGitInspectRequest(request);
    const repository = await resolveGitRepository(this.options.workspaceRoot);
    const before = await snapshotGitRepository(repository);
    const args = gitInspectArguments(repository, request);
    const argumentsSha256 = gitInspectionArgumentsSha256(repository, request);
    const timeoutMs = request.timeoutMs ?? DEFAULT_GIT_INSPECT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let commandDetails: GitInspectProcessResult | undefined;
    let durationMs = 0;
    let output = "";
    try {
      const config = await runGitInspectProcess(
        this.options,
        gitConfigPolicyArguments(repository),
        timeoutMs,
        signal,
      );
      durationMs += config.durationMs;
      if (
        config.status !== "succeeded" ||
        config.stderr.length > 0 ||
        !gitConfigKeysPermitInspection(config.stdout)
      ) {
        throw new Error("Git repository has unsafe execution configuration");
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new Error("Git inspection timed out");
      const result = await runGitInspectProcess(
        this.options,
        args,
        remainingMs,
        signal,
      );
      commandDetails = result;
      durationMs += result.durationMs;
      output = result.stdout;
      if (
        result.status === "output_capped" ||
        Buffer.byteLength(output, "utf8") > MAX_GIT_INSPECT_OUTPUT_BYTES
      ) {
        throw new Error("Git inspection output exceeds its bounded limit");
      }
      if (result.status !== "succeeded" || result.stderr.length > 0) {
        throw new Error("Git inspection failed");
      }
    } finally {
      const after = await snapshotGitRepository(repository);
      if (after.stateSha256 !== before.stateSha256) {
        throw new Error("Git repository metadata changed during inspection");
      }
    }
    if (!commandDetails) throw new Error("Git inspection did not execute");
    return finalizeGitInspection(
      request,
      before,
      commandDetails,
      argumentsSha256,
      durationMs,
      output,
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
    ...(request.action === "diff" && request.path
      ? { pathSha256: sha256(request.path) }
      : {}),
    ...(request.action === "diff"
      ? { contextLines: request.contextLines ?? 3 }
      : {}),
    ...counts,
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

async function resolveGitRepository(
  workspaceRoot: string,
): Promise<GitRepository> {
  const root = await realpath(path.resolve(workspaceRoot));
  const gitDirectory = path.join(root, ".git");
  let info;
  try {
    info = await lstat(gitDirectory);
  } catch {
    throw new Error("Workspace root is not a supported Git repository");
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Workspace root is not a supported Git repository");
  }
  const resolvedGitDirectory = await realpath(gitDirectory);
  if (
    resolvedGitDirectory !== gitDirectory ||
    !isPathInside(resolvedGitDirectory, root)
  ) {
    throw new Error("Git directory escapes the workspace");
  }
  const entries = await readdir(resolvedGitDirectory);
  if (
    entries.some(
      (name) => name === "config.worktree" || name.startsWith("sharedindex."),
    ) ||
    (await pathExists(path.join(resolvedGitDirectory, "info/sparse-checkout")))
  ) {
    throw new Error("Git repository uses unsupported metadata extensions");
  }
  return { root, gitDirectory: resolvedGitDirectory };
}

async function snapshotGitRepository(
  repository: GitRepository,
): Promise<GitRepositoryState> {
  if (await pathExists(path.join(repository.gitDirectory, "index.lock"))) {
    throw new Error("Git repository has an active index lock");
  }
  const head = await readBoundFile(
    path.join(repository.gitDirectory, "HEAD"),
    MAX_GIT_METADATA_BYTES,
    false,
  );
  const headText = await readBoundText(
    path.join(repository.gitDirectory, "HEAD"),
    MAX_GIT_METADATA_BYTES,
  );
  const currentRef = currentHeadRef(headText);
  const ref = currentRef
    ? await readBoundFile(
        path.join(repository.gitDirectory, currentRef),
        MAX_GIT_METADATA_BYTES,
        true,
      )
    : absentFile();
  const [packedRefs, index, config, shallow] = await Promise.all([
    readBoundFile(
      path.join(repository.gitDirectory, "packed-refs"),
      MAX_GIT_PACKED_REFS_BYTES,
      true,
    ),
    readBoundFile(
      path.join(repository.gitDirectory, "index"),
      MAX_GIT_INDEX_BYTES,
      true,
    ),
    readBoundFile(
      path.join(repository.gitDirectory, "config"),
      MAX_GIT_CONFIG_BYTES,
      false,
    ),
    readBoundFile(
      path.join(repository.gitDirectory, "shallow"),
      MAX_GIT_PACKED_REFS_BYTES,
      true,
    ),
  ]);
  const headStateSha256 = sha256(
    canonicalJson({ head, currentRef: currentRef ?? null, ref, packedRefs }),
  );
  return {
    stateSha256: sha256(
      canonicalJson({ headStateSha256, index, config, shallow }),
    ),
    headStateSha256,
    index,
    config,
  };
}

function currentHeadRef(head: string): string | undefined {
  const value = head.trim();
  if (!value.startsWith("ref: ")) return undefined;
  const reference = value.slice(5);
  const segments = reference.split("/");
  if (
    !GIT_REF_PATTERN.test(reference) ||
    path.posix.normalize(reference) !== reference ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        isProtectedWorkspacePathSegment(segment),
    )
  ) {
    throw new Error("Git HEAD reference is invalid");
  }
  return reference;
}

async function readBoundText(
  filePath: string,
  maximumBytes: number,
): Promise<string> {
  const value = await readBoundFileBytes(filePath, maximumBytes, false);
  if (!value) throw new Error("Git metadata file is unavailable");
  return value.toString("utf8");
}

async function readBoundFile(
  filePath: string,
  maximumBytes: number,
  optional: boolean,
): Promise<BoundFile> {
  const value = await readBoundFileBytes(filePath, maximumBytes, optional);
  return value
    ? {
        present: true,
        sha256: sha256(value),
        bytes: value.length,
      }
    : absentFile();
}

async function readBoundFileBytes(
  filePath: string,
  maximumBytes: number,
  optional: boolean,
): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) {
      throw new Error("Git metadata file is invalid");
    }
    return await handle.readFile();
  } catch (error) {
    if (optional && errorCode(error) === "ENOENT") return undefined;
    throw new Error("Git metadata file is unavailable");
  } finally {
    await handle?.close();
  }
}

function absentFile(): BoundFile {
  return { present: false, sha256: EMPTY_SHA256, bytes: 0 };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw new Error("Git metadata path is unavailable");
  }
}

function validateGitInspectRequest(request: GitInspectRequest): void {
  if (request.action !== "status" && request.action !== "diff") {
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
  if (request.action === "status") return;
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
  if (request.path !== undefined) validateGitPath(request.path);
}

function validateGitPath(candidate: string): void {
  if (
    !candidate ||
    candidate.length > MAX_GIT_INSPECT_PATH_CHARS ||
    path.isAbsolute(candidate) ||
    !GIT_ARGUMENT_PATTERN.test(candidate)
  ) {
    throw new Error("Git inspection path must be workspace-relative");
  }
  const normalized = path.normalize(candidate);
  if (
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.split(path.sep).some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error("Git inspection path escapes the workspace");
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
