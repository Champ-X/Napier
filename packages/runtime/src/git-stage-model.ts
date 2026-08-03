import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { gitErrorCode, type GitRepository } from "./git-repository.js";

export const DEFAULT_GIT_STAGE_TIMEOUT_MS = 15_000;
export const MAX_GIT_STAGE_TIMEOUT_MS = 30_000;
export const MAX_GIT_STAGE_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_GIT_STAGE_PREVIEWS = 32;
export const GIT_STAGE_PREVIEW_TTL_MS = 5 * 60_000;
const MAX_GIT_ATTRIBUTE_FILES = 64;
const MAX_GIT_ATTRIBUTE_FILE_BYTES = 1024 * 1024;

export interface GitStagePathState {
  present: boolean;
  sha256: string;
  bytes: number;
  executable: boolean;
  stateSha256: string;
}

export interface GitStageDetails {
  kind: "napier.git-stage";
  schemaVersion: 1;
  action: "preview" | "apply";
  status: "ready" | "applied" | "indeterminate";
  postcondition: "not_applied" | "verified" | "indeterminate";
  previewId?: string;
  expiresAt?: string;
  pathSha256: string;
  pathStateSha256: string;
  attributesStateSha256: string;
  contextLines: number;
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  deletedLineCount: number;
  patchSha256: string;
  patchBytes: number;
  beforeRepositoryStateSha256: string;
  beforeNonIndexStateSha256: string;
  beforeIndexSha256: string;
  proposedIndexSha256: string;
  afterIndexSha256?: string;
  sourcePreviewResultSha256?: string;
  sandboxSha256: string;
  gitExecutableSha256: string;
  gitArgumentsSha256: string;
  gitEnvironmentSha256: string;
  gitResourceLimitsSha256: string;
  durationMs: number;
  durable: boolean;
  cancellationObserved: boolean;
  resultSha256: string;
}

export interface GitStagePreview {
  id: string;
  expiresAt: string;
  path: string;
  patch: string;
  selectionMode: "path" | "hunks";
  selectedHunkCount: number;
  details: GitStageDetails;
}

export interface GitStageApplyResult {
  path: string;
  patch: string;
  selectionMode: "path" | "hunks";
  selectedHunkCount: number;
  details: GitStageDetails;
}

export interface GitDiffCounts {
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  deletedLineCount: number;
}

export async function snapshotGitStagePath(
  absolutePath: string,
): Promise<GitStagePathState> {
  let info;
  try {
    info = await lstat(absolutePath);
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") return absentPath();
    throw new Error("Git stage path is unavailable");
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > MAX_GIT_STAGE_FILE_BYTES ||
    (await realpath(absolutePath)) !== absolutePath
  ) {
    throw new Error("Git stage path must be a bounded regular file");
  }
  let handle;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const current = await handle.stat();
    if (
      !current.isFile() ||
      current.size > MAX_GIT_STAGE_FILE_BYTES ||
      current.dev !== info.dev ||
      current.ino !== info.ino
    ) {
      throw new Error("Git stage path changed while it was inspected");
    }
    const content = await readExactPath(handle, current.size);
    const state = {
      present: true,
      sha256: sha256(content),
      bytes: content.length,
      executable: (current.mode & 0o111) !== 0,
    };
    return {
      ...state,
      stateSha256: sha256(canonicalJson(state)),
    };
  } finally {
    await handle?.close();
  }
}

export async function assertGitStagePathAncestors(
  repository: GitRepository,
  targetPath: string,
): Promise<void> {
  let current = repository.root;
  for (const segment of targetPath.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (gitErrorCode(error) === "ENOENT") return;
      throw new Error("Git stage path ancestor is unavailable");
    }
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== current
    ) {
      throw new Error("Git stage path ancestor is not canonical");
    }
  }
}

export async function snapshotGitAttributeState(
  repository: GitRepository,
  targetPath: string,
): Promise<string> {
  const segments = targetPath.split("/");
  const directories = [repository.root];
  let current = repository.root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  const candidates = [
    ...directories.map((directory) => path.join(directory, ".gitattributes")),
    path.join(repository.gitDirectory, "info/attributes"),
  ];
  if (candidates.length > MAX_GIT_ATTRIBUTE_FILES) {
    throw new Error("Git attribute chain exceeds its bounded limit");
  }
  const files = [];
  for (const candidate of candidates) {
    const value = await readOptionalAttributeFile(candidate);
    files.push({
      pathSha256: sha256(path.relative(repository.root, candidate)),
      ...value,
    });
  }
  return sha256(canonicalJson(files));
}

async function readExactPath(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<Buffer> {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(content, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error("Git stage path changed while it was read");
    }
    offset += result.bytesRead;
  }
  const probe = Buffer.alloc(1);
  if ((await handle.read(probe, 0, 1, size)).bytesRead > 0) {
    throw new Error("Git stage path changed while it was read");
  }
  return content;
}

async function readOptionalAttributeFile(filePath: string): Promise<{
  present: boolean;
  sha256: string;
  bytes: number;
  mode: number;
}> {
  let handle;
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.size > MAX_GIT_ATTRIBUTE_FILE_BYTES ||
      (await realpath(filePath)) !== filePath
    ) {
      throw new Error("Git attribute file is invalid");
    }
    const content = await readExactPath(handle, info.size);
    return {
      present: true,
      sha256: sha256(content),
      bytes: content.length,
      mode: info.mode & 0o777,
    };
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") {
      return { present: false, sha256: sha256(""), bytes: 0, mode: 0 };
    }
    throw new Error("Git attribute file is unavailable");
  } finally {
    await handle?.close();
  }
}

export function gitDiffCounts(output: string): GitDiffCounts {
  const lines = output.split("\n");
  return {
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

function absentPath(): GitStagePathState {
  const state = {
    present: false,
    sha256: sha256(""),
    bytes: 0,
    executable: false,
  };
  return {
    ...state,
    stateSha256: sha256(canonicalJson(state)),
  };
}
