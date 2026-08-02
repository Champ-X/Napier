import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_GIT_INDEX_BYTES = 64 * 1024 * 1024;
export const MAX_GIT_PATH_CHARS = 500;
const MAX_GIT_CONFIG_BYTES = 1024 * 1024;
const MAX_GIT_PACKED_REFS_BYTES = 8 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 16 * 1024;
const GIT_ARGUMENT_PATTERN = /^[^\u0000-\u001f\u007f]*$/u;
const GIT_REF_PATTERN =
  /^refs\/(?:heads|tags)\/[^\u0000-\u001f\u007f]{1,500}$/u;
const EMPTY_SHA256 = sha256("");

export interface GitRepository {
  root: string;
  gitDirectory: string;
}

export interface GitBoundFile {
  present: boolean;
  sha256: string;
  bytes: number;
  mode: number;
}

export interface GitRepositoryState {
  stateSha256: string;
  nonIndexStateSha256: string;
  staticStateSha256: string;
  headStateSha256: string;
  currentRef?: string;
  index: GitBoundFile;
  config: GitBoundFile;
}

export async function resolveGitRepository(
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
    (await gitPathExists(
      path.join(resolvedGitDirectory, "info/sparse-checkout"),
    )) ||
    (await gitPathExists(path.join(resolvedGitDirectory, "info/grafts")))
  ) {
    throw new Error("Git repository uses unsupported metadata extensions");
  }
  return { root, gitDirectory: resolvedGitDirectory };
}

export async function snapshotGitRepository(
  repository: GitRepository,
  options: { allowIndexLock?: boolean } = {},
): Promise<GitRepositoryState> {
  if (
    !options.allowIndexLock &&
    (await gitPathExists(path.join(repository.gitDirectory, "index.lock")))
  ) {
    throw new Error("Git repository has an active index lock");
  }
  const head = await readGitBoundFile(
    path.join(repository.gitDirectory, "HEAD"),
    MAX_GIT_METADATA_BYTES,
    false,
  );
  const headText = await readGitBoundText(
    path.join(repository.gitDirectory, "HEAD"),
    MAX_GIT_METADATA_BYTES,
  );
  const currentRef = currentHeadRef(headText);
  const ref = currentRef
    ? await readGitBoundFile(
        path.join(repository.gitDirectory, currentRef),
        MAX_GIT_METADATA_BYTES,
        true,
      )
    : absentFile();
  const [packedRefs, index, config, shallow] = await Promise.all([
    readGitBoundFile(
      path.join(repository.gitDirectory, "packed-refs"),
      MAX_GIT_PACKED_REFS_BYTES,
      true,
    ),
    readGitBoundFile(
      path.join(repository.gitDirectory, "index"),
      MAX_GIT_INDEX_BYTES,
      true,
    ),
    readGitBoundFile(
      path.join(repository.gitDirectory, "config"),
      MAX_GIT_CONFIG_BYTES,
      false,
    ),
    readGitBoundFile(
      path.join(repository.gitDirectory, "shallow"),
      MAX_GIT_PACKED_REFS_BYTES,
      true,
    ),
  ]);
  const headStateSha256 = sha256(
    canonicalJson({ head, currentRef: currentRef ?? null, ref, packedRefs }),
  );
  const staticStateSha256 = sha256(canonicalJson({ config, shallow }));
  const nonIndexStateSha256 = sha256(
    canonicalJson({ headStateSha256, staticStateSha256 }),
  );
  return {
    stateSha256: sha256(
      canonicalJson({ headStateSha256, index, config, shallow }),
    ),
    nonIndexStateSha256,
    staticStateSha256,
    headStateSha256,
    ...(currentRef ? { currentRef } : {}),
    index,
    config,
  };
}

export function normalizeGitPath(candidate: string): string {
  if (
    !candidate ||
    candidate.length > MAX_GIT_PATH_CHARS ||
    path.isAbsolute(candidate) ||
    !GIT_ARGUMENT_PATTERN.test(candidate)
  ) {
    throw new Error("Git path must be workspace-relative");
  }
  const normalized = path.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized.split(path.sep).some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error("Git path escapes the workspace");
  }
  return normalized.split(path.sep).join("/");
}

export async function readGitIndexBytes(
  repository: GitRepository,
): Promise<Buffer | undefined> {
  return (
    await readGitBoundFilePayload(
      path.join(repository.gitDirectory, "index"),
      MAX_GIT_INDEX_BYTES,
      true,
    )
  )?.content;
}

export async function gitPathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (gitErrorCode(error) === "ENOENT") return false;
    throw new Error("Git metadata path is unavailable");
  }
}

export function gitErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

async function readGitBoundText(
  filePath: string,
  maximumBytes: number,
): Promise<string> {
  const value = await readGitBoundFilePayload(filePath, maximumBytes, false);
  if (!value) throw new Error("Git metadata file is unavailable");
  return value.content.toString("utf8");
}

async function readGitBoundFile(
  filePath: string,
  maximumBytes: number,
  optional: boolean,
): Promise<GitBoundFile> {
  const value = await readGitBoundFilePayload(filePath, maximumBytes, optional);
  return value
    ? {
        present: true,
        sha256: sha256(value.content),
        bytes: value.content.length,
        mode: value.mode,
      }
    : absentFile();
}

async function readGitBoundFilePayload(
  filePath: string,
  maximumBytes: number,
  optional: boolean,
): Promise<{ content: Buffer; mode: number } | undefined> {
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
    return {
      content: await readExactFile(handle, info.size),
      mode: info.mode & 0o777,
    };
  } catch (error) {
    if (optional && gitErrorCode(error) === "ENOENT") return undefined;
    throw new Error("Git metadata file is unavailable");
  } finally {
    await handle?.close();
  }
}

async function readExactFile(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<Buffer> {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(content, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error("Git metadata file changed while it was read");
    }
    offset += result.bytesRead;
  }
  const probe = Buffer.alloc(1);
  if ((await handle.read(probe, 0, 1, size)).bytesRead > 0) {
    throw new Error("Git metadata file changed while it was read");
  }
  return content;
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

function absentFile(): GitBoundFile {
  return { present: false, sha256: EMPTY_SHA256, bytes: 0, mode: 0 };
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
