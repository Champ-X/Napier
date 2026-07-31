import { createHash } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./ed25519.js";
import { isPathInsideWorkspace } from "./policy.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_SQLITE_DATABASE_BYTES = 64 * 1024 * 1024;

const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000", "utf8");
const HASH_BUFFER_BYTES = 1024 * 1024;

export interface SqliteDatabaseSnapshot {
  workspaceRoot: string;
  target: string;
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  device: number;
  inode: number;
  modifiedAtMs: number;
}

export async function inspectSqliteDatabase(
  workspaceRootInput: string,
  databasePath: string,
): Promise<SqliteDatabaseSnapshot> {
  if (
    !databasePath ||
    path.isAbsolute(databasePath) ||
    databasePath.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(databasePath)
  ) {
    throw new Error("SQLite database path must be workspace-relative");
  }
  const workspaceRoot = await realpath(path.resolve(workspaceRootInput)).catch(
    () => {
      throw new Error("SQLite workspace is unavailable");
    },
  );
  const lexicalTarget = path.resolve(workspaceRoot, databasePath);
  if (!isPathInsideWorkspace(lexicalTarget, workspaceRoot)) {
    throw new Error("SQLite database path escapes the workspace");
  }
  const relativePath = path.relative(workspaceRoot, lexicalTarget);
  if (
    relativePath
      .split(path.sep)
      .filter(Boolean)
      .some(isProtectedWorkspacePathSegment)
  ) {
    throw new Error("SQLite database targets a protected workspace root");
  }
  if (!SQLITE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    throw new Error("SQLite database must use .db, .sqlite, or .sqlite3");
  }
  const target = await realpath(lexicalTarget).catch(() => {
    throw new Error("SQLite database is unavailable");
  });
  if (path.resolve(target) !== path.resolve(lexicalTarget)) {
    throw new Error("SQLite database path must not traverse a symlink");
  }
  if (!isPathInsideWorkspace(target, workspaceRoot)) {
    throw new Error("SQLite database resolves outside the workspace");
  }
  await assertNoSqliteSidecars(target);
  const observed = await hashSqliteFile(target);
  await assertNoSqliteSidecars(target);
  return {
    workspaceRoot,
    target,
    path: relativePath,
    pathSha256: sha256(relativePath),
    ...observed,
  };
}

export async function assertSqliteDatabaseCurrent(
  snapshot: SqliteDatabaseSnapshot,
): Promise<void> {
  const current = await inspectSqliteDatabase(
    snapshot.workspaceRoot,
    snapshot.path,
  ).catch(() => {
    throw new Error("SQLite database changed during query");
  });
  if (
    current.target !== snapshot.target ||
    current.fileSha256 !== snapshot.fileSha256 ||
    current.fileBytes !== snapshot.fileBytes ||
    current.device !== snapshot.device ||
    current.inode !== snapshot.inode ||
    current.modifiedAtMs !== snapshot.modifiedAtMs
  ) {
    throw new Error("SQLite database changed during query");
  }
}

export async function hashSqliteSnapshotFile(filePath: string): Promise<{
  fileSha256: string;
  fileBytes: number;
}> {
  const observed = await hashSqliteFile(filePath);
  return {
    fileSha256: observed.fileSha256,
    fileBytes: observed.fileBytes,
  };
}

async function hashSqliteFile(filePath: string): Promise<{
  fileSha256: string;
  fileBytes: number;
  device: number;
  inode: number;
  modifiedAtMs: number;
}> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  ).catch(() => {
    throw new Error("SQLite database is unavailable");
  });
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.size < SQLITE_HEADER.byteLength ||
      before.size > MAX_SQLITE_DATABASE_BYTES
    ) {
      throw new Error(
        `SQLite database must be a regular file up to ${MAX_SQLITE_DATABASE_BYTES} bytes`,
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(
      Math.min(
        HASH_BUFFER_BYTES,
        Math.max(SQLITE_HEADER.byteLength, before.size),
      ),
    );
    let offset = 0;
    let header = Buffer.alloc(0);
    while (offset < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, before.size - offset),
        offset,
      );
      if (bytesRead <= 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      if (offset === 0) header = Buffer.from(chunk.subarray(0, 16));
      digest.update(chunk);
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== before.size ||
      header.length !== SQLITE_HEADER.length ||
      !header.equals(SQLITE_HEADER) ||
      !sameIdentity(before, after)
    ) {
      throw new Error("SQLite database changed or is invalid");
    }
    return {
      fileSha256: digest.digest("hex"),
      fileBytes: before.size,
      device: before.dev,
      inode: before.ino,
      modifiedAtMs: before.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

async function assertNoSqliteSidecars(target: string): Promise<void> {
  for (const suffix of ["-journal", "-shm", "-wal"]) {
    const exists = await lstat(`${target}${suffix}`)
      .then(() => true)
      .catch((error: unknown) => {
        if (errorCode(error) === "ENOENT") return false;
        throw new Error("SQLite sidecar state is unavailable");
      });
    if (exists) {
      throw new Error(
        "SQLite database must be a checkpointed static file without sidecars",
      );
    }
  }
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}
