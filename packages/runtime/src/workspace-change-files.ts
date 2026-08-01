import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";
import type {
  WorkspaceChange,
  WorkspaceChangeExpectedFile,
} from "./workspace-change-model.js";

export interface PreparedWorkspaceChange extends WorkspaceChangeExpectedFile {
  target: string;
  parent: string;
  mode: number;
  output?: Buffer;
  temporaryPath?: string;
  backupPath?: string;
  beforeDevice?: number;
  beforeInode?: number;
}

export async function canonicalWorkspaceChangeRoot(
  workspaceRoot: string,
): Promise<string> {
  return realpath(path.resolve(workspaceRoot));
}

export async function prepareWorkspaceChange(
  workspaceRoot: string,
  change: WorkspaceChange,
): Promise<PreparedWorkspaceChange> {
  const target = workspaceChangeTarget(workspaceRoot, change.path);
  const parent = path.dirname(target);
  if (
    (await realpath(parent)) !== parent ||
    !(await stat(parent)).isDirectory()
  ) {
    throw new Error("Workspace change parent is unavailable");
  }
  let mode = change.mode ?? 0o644;
  let beforeDevice: number | undefined;
  let beforeInode: number | undefined;
  if (change.beforeSha256 === null) {
    if ((await currentWorkspaceChangeHash(target)) !== null) {
      throw new Error("Workspace change create target already exists");
    }
  } else {
    const captured = await captureWorkspaceChangeFile(target);
    if (captured.sha256 !== change.beforeSha256) {
      throw new Error("Workspace change preview is stale");
    }
    mode = captured.mode;
    beforeDevice = captured.device;
    beforeInode = captured.inode;
  }
  const output =
    change.afterSha256 === null
      ? undefined
      : Buffer.from(change.content!, "utf8");
  if (output && output.byteLength > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
    throw new Error("Workspace change output exceeds the file limit");
  }
  const suffix = randomBytes(10).toString("hex");
  return {
    path: change.path,
    pathSha256: change.pathSha256,
    beforeSha256: change.beforeSha256,
    expectedSha256: change.afterSha256,
    target,
    parent,
    mode,
    ...(output ? { output } : {}),
    ...(output || change.afterSha256 === null
      ? {
          temporaryPath: path.join(
            parent,
            `.${path.basename(target)}.napier-change-${suffix}.${output ? "tmp" : "deleted"}`,
          ),
        }
      : {}),
    ...(change.beforeSha256 !== null
      ? {
          backupPath: path.join(
            parent,
            `.${path.basename(target)}.napier-change-${suffix}.bak`,
          ),
          beforeDevice: beforeDevice!,
          beforeInode: beforeInode!,
        }
      : {}),
  };
}

export async function stageWorkspaceChange(
  change: PreparedWorkspaceChange,
): Promise<void> {
  const handle = await open(change.temporaryPath!, "wx", change.mode);
  try {
    await handle.writeFile(change.output!);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function observeWorkspaceChanges(
  changes: PreparedWorkspaceChange[],
): Promise<{
  complete: boolean;
  matchesBefore: boolean;
  matchesExpected: boolean;
  fileSetSha256?: string;
}> {
  const observed = [];
  try {
    for (const change of changes) {
      observed.push({
        pathSha256: change.pathSha256,
        fileSha256: await currentWorkspaceChangeHash(change.target),
      });
    }
  } catch {
    return {
      complete: false,
      matchesBefore: false,
      matchesExpected: false,
    };
  }
  return {
    complete: true,
    matchesBefore: observed.every(
      (entry, index) => entry.fileSha256 === changes[index]!.beforeSha256,
    ),
    matchesExpected: observed.every(
      (entry, index) => entry.fileSha256 === changes[index]!.expectedSha256,
    ),
    fileSetSha256: sha256(canonicalJson(observed)),
  };
}

export async function cleanupWorkspaceChanges(
  staged: PreparedWorkspaceChange[],
  backups: PreparedWorkspaceChange[],
): Promise<{
  complete: boolean;
  remainingBackupCount: number;
  remainingArtifactCount: number;
}> {
  const temporaryOutcomes = await Promise.allSettled(
    staged
      .filter((change) => change.temporaryPath)
      .map((change) => unlink(change.temporaryPath!)),
  );
  const backupOutcomes = await Promise.allSettled(
    backups
      .filter((change) => change.backupPath)
      .map((change) => unlink(change.backupPath!)),
  );
  const remainingTemporaryCount = remaining(temporaryOutcomes);
  const remainingBackupCount = remaining(backupOutcomes);
  return {
    complete: remainingTemporaryCount === 0 && remainingBackupCount === 0,
    remainingBackupCount,
    remainingArtifactCount: remainingTemporaryCount + remainingBackupCount,
  };
}

export async function syncWorkspaceChangeDirectories(
  changes: PreparedWorkspaceChange[],
): Promise<boolean> {
  const outcomes = await Promise.allSettled(
    [...new Set(changes.map((change) => change.parent))].map(
      async (directory) => {
        const handle = await open(directory, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      },
    ),
  );
  return outcomes.every((outcome) => outcome.status === "fulfilled");
}

export async function currentWorkspaceChangeHash(
  target: string,
): Promise<string | null> {
  try {
    return (await captureWorkspaceChangeFile(target)).sha256;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export async function assertWorkspaceChangeBeforeState(
  change: PreparedWorkspaceChange,
): Promise<void> {
  if (change.beforeSha256 === null) {
    if ((await currentWorkspaceChangeHash(change.target)) !== null) {
      throw new Error(
        "Workspace change target changed before coordinated commit",
      );
    }
    return;
  }
  const captured = await captureWorkspaceChangeFile(change.target);
  if (
    captured.sha256 !== change.beforeSha256 ||
    captured.device !== change.beforeDevice ||
    captured.inode !== change.beforeInode
  ) {
    throw new Error(
      "Workspace change target changed before coordinated commit",
    );
  }
}

export async function assertWorkspaceChangeMovedState(
  change: PreparedWorkspaceChange,
): Promise<void> {
  if (
    !change.temporaryPath ||
    change.beforeSha256 === null ||
    change.beforeDevice === undefined ||
    change.beforeInode === undefined
  ) {
    throw new Error("Workspace change moved state is unavailable");
  }
  const captured = await captureWorkspaceChangeFile(change.temporaryPath);
  if (
    captured.sha256 !== change.beforeSha256 ||
    captured.device !== change.beforeDevice ||
    captured.inode !== change.beforeInode
  ) {
    throw new Error("Workspace change deleted file changed during commit");
  }
}

export function workspaceChangeTarget(
  workspaceRoot: string,
  relativePath: string,
): string {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(relativePath) ||
    relativePath
      .split("/")
      .some(
        (segment) =>
          !segment ||
          segment === "." ||
          segment === ".." ||
          isProtectedWorkspacePathSegment(segment),
      )
  ) {
    throw new Error("Workspace change path is invalid");
  }
  const target = path.resolve(workspaceRoot, ...relativePath.split("/"));
  if (
    target === workspaceRoot ||
    !target.startsWith(`${workspaceRoot}${path.sep}`)
  ) {
    throw new Error("Workspace change path escapes the workspace");
  }
  return target;
}

export function workspaceChangeExpectedFile(
  change: PreparedWorkspaceChange,
): WorkspaceChangeExpectedFile {
  return {
    path: change.path,
    pathSha256: change.pathSha256,
    beforeSha256: change.beforeSha256,
    expectedSha256: change.expectedSha256,
  };
}

function remaining(outcomes: PromiseSettledResult<void>[]): number {
  return outcomes.filter(
    (outcome) =>
      outcome.status === "rejected" && errorCode(outcome.reason) !== "ENOENT",
  ).length;
}

function decodeUtf8(buffer: Buffer, label: string): void {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

async function captureWorkspaceChangeFile(target: string): Promise<{
  sha256: string;
  mode: number;
  device: number;
  inode: number;
}> {
  if ((await realpath(target)) !== target) {
    throw new Error("Workspace change target is not canonical");
  }
  const handle = await open(
    target,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_LSP_DIAGNOSTIC_FILE_BYTES) {
      throw new Error("Workspace change target is unsafe");
    }
    const buffer = await handle.readFile();
    const current = await lstat(target);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      (await realpath(target)) !== target
    ) {
      throw new Error("Workspace change target changed during capture");
    }
    decodeUtf8(buffer, "Workspace change target");
    return {
      sha256: sha256(buffer),
      mode: opened.mode & 0o777,
      device: opened.dev,
      inode: opened.ino,
    };
  } finally {
    await handle.close();
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}
