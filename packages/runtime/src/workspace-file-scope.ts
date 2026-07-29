import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rmdir,
} from "node:fs/promises";
import path from "node:path";

import type {
  JsonValue,
  WorkspaceFileEntryKind,
  WorkspaceTrashItem,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_WORKSPACE_FILE_MUTATION_ENTRIES = 2_000;
export const MAX_WORKSPACE_FILE_MUTATION_BYTES = 32 * 1024 * 1024;

const PROTECTED_PATH_SEGMENTS = new Set([".git", ".napier", "node_modules"]);
const TRASH_ID = /^trash_[a-z0-9]{8,80}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;

export interface WorkspaceFileMutationScope {
  entryKind: WorkspaceFileEntryKind;
  snapshotSha256: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
}

export interface WorkspaceEntrySnapshot extends WorkspaceFileMutationScope {
  target: string;
  parent: string;
}

export interface MissingPathPlan {
  target: string;
  parent: string;
  missingDirectories: string[];
  parentStateSha256: string;
}

export function isProtectedWorkspacePathSegment(segment: string): boolean {
  return PROTECTED_PATH_SEGMENTS.has(segment.toLowerCase());
}

export function normalizeMutationPath(candidate: string): string {
  if (
    !candidate ||
    candidate.length > 500 ||
    path.isAbsolute(candidate) ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    throw new Error(
      "Workspace file mutation path must be a visible workspace-relative path",
    );
  }
  const normalized = path.normalize(candidate);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Workspace file mutation path escapes the workspace");
  }
  const protectedSegment = normalized
    .split(path.sep)
    .find(isProtectedWorkspacePathSegment);
  if (protectedSegment) {
    throw new Error(
      `Workspace file mutation cannot modify protected path segment: ${protectedSegment}`,
    );
  }
  return normalized;
}

export async function inspectWorkspaceEntry(
  workspaceRoot: string,
  relativePath: string,
): Promise<WorkspaceEntrySnapshot> {
  const root = await realpath(path.resolve(workspaceRoot));
  const target = path.resolve(root, relativePath);
  if (!isInside(target, root)) {
    throw new Error("Workspace file mutation path escapes the workspace");
  }
  await assertSafePathComponents(root, relativePath);
  return inspectAbsoluteEntry(target);
}

export async function inspectAbsoluteEntry(
  target: string,
): Promise<WorkspaceEntrySnapshot> {
  const rootInfo = await lstat(target);
  if (rootInfo.isSymbolicLink()) {
    throw new Error("Workspace file mutation refuses symbolic links");
  }
  if (!rootInfo.isFile() && !rootInfo.isDirectory()) {
    throw new Error("Workspace file mutation supports files and directories");
  }
  const entries: Array<{
    path: string;
    kind: WorkspaceFileEntryKind;
    sha256?: string;
    sizeBytes: number;
  }> = [];
  let fileCount = 0;
  let directoryCount = 0;
  let bytes = 0;
  const visit = async (current: string, relative: string): Promise<void> => {
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error("Workspace file mutation refuses symbolic links");
    }
    if (info.isDirectory()) {
      directoryCount += 1;
      entries.push({ path: relative, kind: "directory", sizeBytes: 0 });
      assertScopeLimit(entries.length, bytes);
      const children = await readdir(current, { withFileTypes: true });
      children.sort(compareDirectoryEntries);
      for (const child of children) {
        if (isProtectedWorkspacePathSegment(child.name)) {
          throw new Error(
            `Workspace file mutation scope contains protected path segment: ${child.name}`,
          );
        }
        await visit(
          path.join(current, child.name),
          relative === "." ? child.name : path.join(relative, child.name),
        );
      }
      return;
    }
    if (!info.isFile()) {
      throw new Error(
        "Workspace file mutation scope contains an unsupported entry",
      );
    }
    if (bytes + info.size > MAX_WORKSPACE_FILE_MUTATION_BYTES) {
      throw new Error("Workspace file mutation scope exceeds its byte limit");
    }
    const buffer = await readFile(current);
    fileCount += 1;
    bytes += buffer.byteLength;
    entries.push({
      path: relative,
      kind: "file",
      sha256: sha256(buffer),
      sizeBytes: buffer.byteLength,
    });
    assertScopeLimit(entries.length, bytes);
  };
  await visit(target, ".");
  const entryKind: WorkspaceFileEntryKind = rootInfo.isFile()
    ? "file"
    : "directory";
  return {
    target,
    parent: path.dirname(target),
    entryKind,
    snapshotSha256: sha256(canonicalJson(entries)),
    fileCount,
    directoryCount,
    bytes,
  };
}

export async function inspectMissingPath(
  workspaceRoot: string,
  relativePath: string,
  allowMissingParents: boolean,
): Promise<MissingPathPlan> {
  const root = await realpath(path.resolve(workspaceRoot));
  const target = path.resolve(root, relativePath);
  if (!isInside(target, root)) {
    throw new Error("Workspace file mutation path escapes the workspace");
  }
  const segments = relativePath.split(path.sep);
  const missingDirectories: string[] = [];
  let cursor = root;
  let missing = false;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    if (missing) {
      missingDirectories.push(cursor);
      continue;
    }
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        throw new Error(
          "Workspace file mutation refuses symlink path components",
        );
      }
      if (index === segments.length - 1) {
        throw new Error("Workspace file mutation destination already exists");
      }
      if (!info.isDirectory()) {
        throw new Error(
          "Workspace file mutation destination parent must be a directory",
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      missing = true;
      missingDirectories.push(cursor);
    }
  }
  if (
    !allowMissingParents &&
    missingDirectories.some((directory) => directory !== target)
  ) {
    throw new Error(
      "Workspace file mutation destination parent does not exist",
    );
  }
  const parent = path.dirname(target);
  const existingAncestor =
    missingDirectories.length > 0
      ? path.dirname(missingDirectories[0]!)
      : parent;
  const ancestorReal = await realpath(existingAncestor);
  if (!isInside(ancestorReal, root)) {
    throw new Error(
      "Workspace file mutation destination parent escapes the workspace",
    );
  }
  return {
    target,
    parent,
    missingDirectories,
    parentStateSha256: await directoryIdentitySha256(ancestorReal),
  };
}

export async function inspectMissingAbsolutePath(
  target: string,
): Promise<MissingPathPlan> {
  try {
    await lstat(target);
    throw new Error("Workspace trash destination already exists");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return {
    target,
    parent: path.dirname(target),
    missingDirectories: [target],
    parentStateSha256: await directoryIdentitySha256(path.dirname(target)),
  };
}

export function scopeFromSnapshot(
  snapshot: WorkspaceEntrySnapshot,
): WorkspaceFileMutationScope {
  return {
    entryKind: snapshot.entryKind,
    snapshotSha256: snapshot.snapshotSha256,
    fileCount: snapshot.fileCount,
    directoryCount: snapshot.directoryCount,
    bytes: snapshot.bytes,
  };
}

export async function createMissingDirectories(
  directories: readonly string[],
): Promise<string[]> {
  const created: string[] = [];
  try {
    for (const directory of directories) {
      await mkdir(directory, { mode: 0o755 });
      created.push(directory);
      await syncDirectory(path.dirname(directory));
    }
    return created;
  } catch (error) {
    await cleanupEmptyDirectories(created);
    throw error;
  }
}

export function createTrashItem(input: {
  id: string;
  threadId: string;
  runId: string;
  originalPath: string;
  source: WorkspaceEntrySnapshot;
  trashedAt: string;
}): WorkspaceTrashItem {
  const content = {
    kind: "napier.workspace-trash-item" as const,
    schemaVersion: 1 as const,
    id: input.id,
    threadId: input.threadId,
    runId: input.runId,
    originalPath: input.originalPath,
    originalPathSha256: sha256(input.originalPath),
    entryKind: input.source.entryKind,
    snapshotSha256: input.source.snapshotSha256,
    fileCount: input.source.fileCount,
    directoryCount: input.source.directoryCount,
    bytes: input.source.bytes,
    trashedAt: input.trashedAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function parseTrashItem(value: unknown): WorkspaceTrashItem | undefined {
  if (!record(value)) return undefined;
  if (
    value["kind"] !== "napier.workspace-trash-item" ||
    value["schemaVersion"] !== 1 ||
    typeof value["id"] !== "string" ||
    !TRASH_ID.test(value["id"]) ||
    typeof value["threadId"] !== "string" ||
    !RESOURCE_ID.test(value["threadId"]) ||
    typeof value["runId"] !== "string" ||
    !RESOURCE_ID.test(value["runId"]) ||
    typeof value["originalPath"] !== "string" ||
    !hash(value["originalPathSha256"]) ||
    (value["entryKind"] !== "file" && value["entryKind"] !== "directory") ||
    !hash(value["snapshotSha256"]) ||
    !nonNegativeInteger(value["fileCount"]) ||
    !nonNegativeInteger(value["directoryCount"]) ||
    !nonNegativeInteger(value["bytes"]) ||
    !isoDate(value["trashedAt"]) ||
    !hash(value["contentSha256"])
  ) {
    return undefined;
  }
  const { contentSha256, ...content } = value;
  if (
    sha256(canonicalJson(content as JsonValue)) !== contentSha256 ||
    sha256(value["originalPath"]) !== value["originalPathSha256"]
  ) {
    return undefined;
  }
  try {
    if (
      normalizeMutationPath(value["originalPath"]) !== value["originalPath"]
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return structuredClone(value) as unknown as WorkspaceTrashItem;
}

export async function writeJsonExclusive(
  target: string,
  value: unknown,
): Promise<void> {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(target));
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function compareDirectoryEntries(
  left: { name: string },
  right: { name: string },
): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

async function assertSafePathComponents(
  root: string,
  relativePath: string,
): Promise<void> {
  let cursor = root;
  for (const segment of relativePath.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      throw new Error(
        "Workspace file mutation refuses symlink path components",
      );
    }
  }
}

async function cleanupEmptyDirectories(
  directories: readonly string[],
): Promise<void> {
  for (const directory of directories.slice().reverse()) {
    try {
      await rmdir(directory);
      await syncDirectory(path.dirname(directory));
    } catch {
      // A concurrent writer may have made the directory non-empty.
    }
  }
}

function assertScopeLimit(entryCount: number, bytes: number): void {
  if (entryCount > MAX_WORKSPACE_FILE_MUTATION_ENTRIES) {
    throw new Error("Workspace file mutation scope exceeds its entry limit");
  }
  if (bytes > MAX_WORKSPACE_FILE_MUTATION_BYTES) {
    throw new Error("Workspace file mutation scope exceeds its byte limit");
  }
}

async function directoryIdentitySha256(directory: string): Promise<string> {
  const canonicalDirectory = await realpath(directory);
  const info = await lstat(canonicalDirectory);
  if (!info.isDirectory()) {
    throw new Error(
      "Workspace file mutation destination parent must be a directory",
    );
  }
  return sha256(
    canonicalJson({
      pathSha256: sha256(canonicalDirectory),
      device: String(info.dev),
      inode: String(info.ino),
      mode: info.mode,
      birthtimeMs: info.birthtimeMs,
    }),
  );
}

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}
