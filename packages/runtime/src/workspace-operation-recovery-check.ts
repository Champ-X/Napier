import { lstat } from "node:fs/promises";
import path from "node:path";
import { acquireWorkspacePathLocks, type WorkspacePathLockLease } from "./workspace-write-lock.js";

export const MAX_RECOVERY_OPERATIONS = 128;
export const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;
export interface WorkspaceOperationRecoveryCheck {
  paths: string[];
  /** The one existing file whose bytes/identity are checked, when applicable. */
  filePath?: string;
  maxBytes: number;
  mismatchReason: string;
  inspect(): Promise<boolean>;
}

/** Built-in independent file operations only. One union lease survives all
 * checks and is retained by the caller through the authority/continuation cut. */
export async function lockWorkspaceOperationChecks(dataRoot: string,
  checks: WorkspaceOperationRecoveryCheck[], label: string): Promise<WorkspacePathLockLease> {
  if (!checks.length) return { release: async () => undefined };
  if (checks.length > MAX_RECOVERY_OPERATIONS) throw new Error("operation_inspection_limit");
  const canonical = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "darwin" || process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const paths = checks.flatMap((check) => check.paths);
  const names = paths.map(canonical).sort();
  if (names.length > 2 * MAX_RECOVERY_OPERATIONS || names.some((name, index) =>
    names.some((other, otherIndex) => index !== otherIndex && (name === other || name.startsWith(other + path.sep)))))
    throw new Error("operation_path_overlap_unsupported");
  const lease = await acquireWorkspacePathLocks(dataRoot, paths, label);
  try {
    await inspectWorkspaceOperationChecks(checks);
    return lease;
  } catch (error) { await lease.release(); throw error; }
}

/** Reinspection is only valid while the caller retains the same union lease. */
export async function inspectWorkspaceOperationChecks(checks: WorkspaceOperationRecoveryCheck[]): Promise<void> {
  const identities = new Set<string>();
  let bytes = 0;
  for (const check of checks) {
    if (check.filePath) {
      const stat = await lstat(check.filePath).catch(() => undefined);
      if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > check.maxBytes) throw new Error(check.mismatchReason);
      bytes += stat.size;
      if (bytes > MAX_RECOVERY_BYTES) throw new Error("operation_inspection_byte_limit");
      const identity = `${stat.dev}:${stat.ino}`;
      if (identities.has(identity)) throw new Error("operation_file_alias_unsupported");
      identities.add(identity);
    }
  }
  for (const check of checks) if (!(await check.inspect())) throw new Error(check.mismatchReason);
}

export function recoveryInspectionReason(error: unknown, prefix: "move" | "patch" | "operation", label: string): string {
  if (error instanceof Error && error.message === `${label} target is already being edited`) return `${prefix}_target_busy`;
  return error instanceof Error && /^(move|patch|operation)_[a-z_]+$/u.test(error.message)
    ? error.message : `${prefix}_environment_inaccessible`;
}
