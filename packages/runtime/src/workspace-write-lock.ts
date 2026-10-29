import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { coordinateWorkspaceLockMetadata, WorkspaceLockCoordinationBusyError } from "./workspace-lock-coordination.js";

interface OwnedLock { fd?: number; path: string; token: string; dev: number; ino: number }

export async function withWorkspacePathLock<T>(dataRoot: string, target: string,
  operation: () => Promise<T>, label = "apply_patch"): Promise<T> {
  return withWorkspacePathLocks(dataRoot, [target], label, operation);
}

export async function withWorkspacePathLocks<T>(dataRoot: string, targets: readonly string[],
  label: string, operation: () => Promise<T>): Promise<T> {
  const lease = await acquireWorkspacePathLocks(dataRoot, targets, label);
  try { return await operation(); } finally { await lease.release(); }
}

export interface WorkspacePathLockLease { release(): Promise<void> }

export async function acquireWorkspacePathLocks(dataRoot: string, targets: readonly string[],
  label: string): Promise<WorkspacePathLockLease> {
  const identities = [...new Set(targets.map((target) => {
    const resolved = path.resolve(target);
    return process.platform === "darwin" || process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }))].sort();
  if (!identities.length) throw new Error(`${label} requires at least one lock target`);
  const locksRoot = path.join(path.resolve(dataRoot), "file-edit-locks");
  await mkdir(locksRoot, { recursive: true, mode: 0o700 });
  const acquired: OwnedLock[] = [];
  try {
    coordinateWorkspaceLockMetadata(dataRoot, () => {
      try {
        for (const identity of identities) acquired.push(acquireLock(
          path.join(locksRoot, `${createHash("sha256").update(identity).digest("hex")}.lock`), label));
      } catch (error) { releaseOwnedLocks(acquired); throw error; }
    });
  } catch (error) {
    // A coordinator commit failure must not leak native descriptors. A lock whose
    // metadata cannot be safely released remains busy until its owner exits.
    closeOwnedDescriptors(acquired);
    if (error instanceof WorkspaceLockCoordinationBusyError)
      throw new Error(`${label} target is already being edited`, { cause: error });
    throw error;
  }
  let released = false;
  return { async release() {
    if (released) return;
    // Updated peers never reclaim a live PID, so they cannot replace this owned
    // lock before its synchronous unlink. Death also prevents any late release.
    // Own release must not depend on coordinator availability after the effect.
    releaseOwnedLocks(acquired);
    released = true;
  } };
}

function acquireLock(lockPath: string, label: string): OwnedLock {
  let fd: number;
  try { fd = openSync(lockPath, "wx", 0o600); }
  catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    if (!removeAbandonedLock(lockPath)) throw new Error(`${label} target is already being edited`);
    try { fd = openSync(lockPath, "wx", 0o600); }
    catch (retryError) {
      if (errorCode(retryError) === "EEXIST") throw new Error(`${label} target is already being edited`);
      throw retryError;
    }
  }
  const { dev, ino } = fstatSync(fd);
  const lock = { fd, path: lockPath, token: randomUUID(), dev, ino };
  try {
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), token: lock.token })}\n`, "utf8");
    fsyncSync(fd);
    return lock;
  } catch (error) {
    // Creation and cleanup share the coordinator; no updated peer can replace it.
    try { if (sameFile(fd, lockPath)) unlinkSync(lockPath); } catch {}
    closeSync(fd);
    throw error;
  }
}

function releaseOwnedLocks(locks: OwnedLock[]): void {
  for (const lock of locks.splice(0).reverse()) {
    try {
      const metadata = lstatSync(lock.path);
      const owner = readOwner(lock.path);
      if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.dev === lock.dev && metadata.ino === lock.ino &&
          (lock.fd === undefined || sameFile(lock.fd, lock.path)) && owner?.pid === process.pid && owner.token === lock.token)
        unlinkSync(lock.path);
    } catch {} finally { closeOwnedDescriptors([lock]); }
  }
}

function closeOwnedDescriptors(locks: OwnedLock[]): void {
  for (const lock of locks) {
    if (lock.fd !== undefined) { try { closeSync(lock.fd); } catch {} }
    delete lock.fd;
  }
}

function removeAbandonedLock(lockPath: string): boolean {
  try {
    const owner = readOwner(lockPath);
    // Malformed/ownerless legacy files cannot prove a process exited. Age is not authority.
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if (errorCode(error) !== "ESRCH") return false; }
    unlinkSync(lockPath);
    return true;
  } catch (error) { return errorCode(error) === "ENOENT"; }
}

function readOwner(lockPath: string): { pid: number; token?: string } | undefined {
  const metadata = lstatSync(lockPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > 4096) return undefined;
  const fd = openSync(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) return undefined;
    const bytes = Buffer.alloc(metadata.size);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    const current = fstatSync(fd);
    if (length !== bytes.length || current.dev !== metadata.dev || current.ino !== metadata.ino || current.size !== metadata.size) return undefined;
    try {
      const value = JSON.parse(bytes.toString("utf8")) as { pid?: unknown; token?: unknown };
      if (!value || typeof value !== "object" || typeof value.pid !== "number" ||
          (value.token !== undefined && (typeof value.token !== "string" || !/^[a-f0-9-]{36}$/u.test(value.token)))) return undefined;
      return { pid: value.pid, ...(typeof value.token === "string" ? { token: value.token } : {}) };
    } catch { return undefined; }
  } finally { closeSync(fd); }
}

function sameFile(fd: number, lockPath: string): boolean {
  const opened = fstatSync(fd), current = lstatSync(lockPath);
  return current.isFile() && !current.isSymbolicLink() && opened.dev === current.dev && opened.ino === current.ino;
}
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : undefined;
}
