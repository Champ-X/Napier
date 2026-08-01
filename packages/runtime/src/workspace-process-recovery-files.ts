import {
  chmod,
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import type { WorkspaceFileEntryKind } from "@napier/contracts";

import {
  copyWorkspaceProcessRecoveryEntry,
  inspectWorkspaceProcessRecoveryEntry,
} from "./workspace-process-recovery-entry.js";
import { syncDirectory } from "./workspace-file-scope.js";

export interface WorkspaceProcessRecoveryScope {
  relativePath: string;
  relativePathSha256: string;
  backupName: string;
  entryKind: WorkspaceFileEntryKind;
  snapshotSha256: string;
  modeSetSha256: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
}

export interface WorkspaceProcessRecoveryScopeTotals {
  scopeCount: number;
  fileCount: number;
  directoryCount: number;
  bytes: number;
}

export interface WorkspaceProcessRecoveryRestoreOutcome {
  status: "restored" | "reverted" | "indeterminate";
  restoredScopeCount: number;
  durable: boolean;
  cancellationObserved: boolean;
  cleanupTargets: string[];
  error?: unknown;
}

interface PreparedWorkspaceProcessRecoveryScope {
  scope: WorkspaceProcessRecoveryScope;
  target: string;
  stage: string;
  displaced: string;
}

export async function captureWorkspaceProcessRecoveryScopes(input: {
  recoveryDirectory: string;
  absolutePaths: string[];
  relativePaths: string[];
  maximumEntries: number;
  maximumBytes: number;
  pathSha256(path: string): string;
  signal?: AbortSignal;
}): Promise<{
  scopes: WorkspaceProcessRecoveryScope[];
  totals: WorkspaceProcessRecoveryScopeTotals;
}> {
  if (input.absolutePaths.length !== input.relativePaths.length) {
    throw new Error("Workspace Process recovery scope binding is invalid");
  }
  await mkdir(input.recoveryDirectory, { recursive: false, mode: 0o700 });
  const scopes: WorkspaceProcessRecoveryScope[] = [];
  let fileCount = 0;
  let directoryCount = 0;
  let bytes = 0;
  try {
    for (const [index, source] of input.absolutePaths.entries()) {
      input.signal?.throwIfAborted();
      const before = await inspectWorkspaceProcessRecoveryEntry(source);
      fileCount += before.fileCount;
      directoryCount += before.directoryCount;
      bytes += before.bytes;
      if (
        fileCount + directoryCount > input.maximumEntries ||
        bytes > input.maximumBytes
      ) {
        throw new Error(
          "Workspace Process recovery snapshot exceeds its aggregate limit",
        );
      }
      const backupName = `scope-${String(index).padStart(2, "0")}`;
      const backup = path.join(input.recoveryDirectory, backupName);
      await copyWorkspaceProcessRecoveryEntry(source, backup);
      const [sourceAfter, observedBackup] = await Promise.all([
        inspectWorkspaceProcessRecoveryEntry(source),
        inspectWorkspaceProcessRecoveryEntry(backup),
      ]);
      if (
        sourceAfter.snapshotSha256 !== before.snapshotSha256 ||
        observedBackup.snapshotSha256 !== before.snapshotSha256 ||
        sourceAfter.modeSetSha256 !== before.modeSetSha256 ||
        observedBackup.modeSetSha256 !== before.modeSetSha256 ||
        observedBackup.entryKind !== before.entryKind ||
        observedBackup.fileCount !== before.fileCount ||
        observedBackup.directoryCount !== before.directoryCount ||
        observedBackup.bytes !== before.bytes
      ) {
        throw new Error(
          "Workspace Process recovery source changed while it was captured",
        );
      }
      const relativePath = input.relativePaths[index]!;
      scopes.push({
        relativePath,
        relativePathSha256: input.pathSha256(relativePath),
        backupName,
        entryKind: before.entryKind,
        snapshotSha256: before.snapshotSha256,
        modeSetSha256: before.modeSetSha256,
        fileCount: before.fileCount,
        directoryCount: before.directoryCount,
        bytes: before.bytes,
      });
    }
    await syncDirectory(input.recoveryDirectory);
    return {
      scopes,
      totals: {
        scopeCount: scopes.length,
        fileCount,
        directoryCount,
        bytes,
      },
    };
  } catch (error) {
    await removeRecoveryEntry(input.recoveryDirectory).catch(() => undefined);
    throw error;
  }
}

export async function verifyWorkspaceProcessRecoveryScopes(input: {
  recoveryDirectory: string;
  scopes: WorkspaceProcessRecoveryScope[];
}): Promise<void> {
  for (const scope of input.scopes) {
    const observed = await inspectWorkspaceProcessRecoveryEntry(
      path.join(input.recoveryDirectory, scope.backupName),
    );
    if (
      observed.entryKind !== scope.entryKind ||
      observed.snapshotSha256 !== scope.snapshotSha256 ||
      observed.modeSetSha256 !== scope.modeSetSha256 ||
      observed.fileCount !== scope.fileCount ||
      observed.directoryCount !== scope.directoryCount ||
      observed.bytes !== scope.bytes
    ) {
      throw new Error("Workspace Process recovery snapshot drifted");
    }
  }
}

export async function restoreWorkspaceProcessRecoveryScopes(input: {
  workspaceRoot: string;
  recoveryDirectory: string;
  rollbackId: string;
  scopes: WorkspaceProcessRecoveryScope[];
  signal?: AbortSignal;
  renameEntry?: typeof rename;
  beforeCommit?: () => void;
  stageEntry?: typeof copyWorkspaceProcessRecoveryEntry;
  syncParents?: (
    prepared: PreparedWorkspaceProcessRecoveryScope[],
  ) => Promise<boolean>;
}): Promise<WorkspaceProcessRecoveryRestoreOutcome> {
  input.signal?.throwIfAborted();
  await verifyWorkspaceProcessRecoveryScopes(input);
  const renameEntry = input.renameEntry ?? rename;
  const stageEntry = input.stageEntry ?? copyWorkspaceProcessRecoveryEntry;
  const syncParents = input.syncParents ?? syncRollbackParents;
  const prepared: PreparedWorkspaceProcessRecoveryScope[] = [];
  try {
    for (const [index, scope] of input.scopes.entries()) {
      const target = path.resolve(input.workspaceRoot, scope.relativePath);
      const suffix = `${input.rollbackId}-${String(index).padStart(2, "0")}`;
      const stage = path.join(
        path.dirname(target),
        `.napier-process-rollback-stage-${suffix}`,
      );
      const displaced = path.join(
        path.dirname(target),
        `.napier-process-rollback-current-${suffix}`,
      );
      await assertMissing(stage);
      await assertMissing(displaced);
      const item = { scope, target, stage, displaced };
      prepared.push(item);
      await stageEntry(
        path.join(input.recoveryDirectory, scope.backupName),
        stage,
      );
      const observed = await inspectWorkspaceProcessRecoveryEntry(stage);
      if (
        observed.entryKind !== scope.entryKind ||
        observed.snapshotSha256 !== scope.snapshotSha256 ||
        observed.modeSetSha256 !== scope.modeSetSha256
      ) {
        throw new Error("Workspace Process rollback staging drifted");
      }
    }
  } catch (error) {
    return settleUncommittedWorkspaceProcessRollback(prepared, error, false);
  }
  input.beforeCommit?.();
  if (input.signal?.aborted) {
    return settleUncommittedWorkspaceProcessRollback(
      prepared,
      new Error("Workspace Process rollback was cancelled before commitment"),
      true,
    );
  }
  const displaced = new Set<(typeof prepared)[number]>();
  const committed = new Set<(typeof prepared)[number]>();
  let commitError: unknown;
  for (const item of prepared) {
    try {
      if (await exists(item.target)) {
        await renameEntry(item.target, item.displaced);
        displaced.add(item);
      }
      await renameEntry(item.stage, item.target);
      committed.add(item);
    } catch (error) {
      commitError = error;
      break;
    }
  }
  if (commitError) {
    const reverted = await revertWorkspaceProcessRollback(
      prepared,
      displaced,
      committed,
      renameEntry,
    );
    return settleRevertedWorkspaceProcessRollback(
      prepared,
      reverted,
      syncParents,
      commitError,
      input.signal?.aborted === true,
    );
  }
  let verified = true;
  for (const item of prepared) {
    const observed = await inspectWorkspaceProcessRecoveryEntry(
      item.target,
    ).catch(() => undefined);
    if (
      !observed ||
      observed.entryKind !== item.scope.entryKind ||
      observed.snapshotSha256 !== item.scope.snapshotSha256 ||
      observed.modeSetSha256 !== item.scope.modeSetSha256
    ) {
      verified = false;
      break;
    }
  }
  if (!verified) {
    const reverted = await revertWorkspaceProcessRollback(
      prepared,
      displaced,
      committed,
      renameEntry,
    );
    return settleRevertedWorkspaceProcessRollback(
      prepared,
      reverted,
      syncParents,
      new Error("Workspace Process rollback verification failed"),
      input.signal?.aborted === true,
    );
  }
  const durable = await syncParents(prepared);
  return {
    status: durable ? "restored" : "indeterminate",
    restoredScopeCount: committed.size,
    durable,
    cancellationObserved: input.signal?.aborted === true,
    cleanupTargets: prepared.flatMap((item) => [item.stage, item.displaced]),
    ...(durable
      ? {}
      : {
          error: new Error(
            "Workspace Process rollback durability verification failed",
          ),
        }),
  };
}

export async function cleanupWorkspaceProcessRollbackArtifacts(
  cleanupTargets: string[],
): Promise<boolean> {
  for (const target of cleanupTargets) {
    await removeRecoveryEntry(target);
  }
  const parents = [
    ...new Set(cleanupTargets.map((target) => path.dirname(target))),
  ];
  const synced = await Promise.allSettled(
    parents.map((parent) => syncDirectory(parent)),
  );
  return synced.every((result) => result.status === "fulfilled");
}

export async function removeWorkspaceProcessRecovery(
  recoveryDirectory: string,
): Promise<void> {
  await removeRecoveryEntry(recoveryDirectory);
}

async function revertWorkspaceProcessRollback(
  prepared: PreparedWorkspaceProcessRecoveryScope[],
  displaced: Set<(typeof prepared)[number]>,
  committed: Set<(typeof prepared)[number]>,
  renameEntry: typeof rename,
): Promise<boolean> {
  let complete = true;
  for (const item of prepared.slice().reverse()) {
    try {
      if (committed.has(item) && (await exists(item.target))) {
        await renameEntry(item.target, item.stage);
      }
      if (displaced.has(item) && (await exists(item.displaced))) {
        await renameEntry(item.displaced, item.target);
      }
    } catch {
      complete = false;
    }
  }
  for (const item of prepared) {
    await removeRecoveryEntry(item.stage).catch(() => undefined);
  }
  return complete;
}

async function syncRollbackParents(
  prepared: PreparedWorkspaceProcessRecoveryScope[],
): Promise<boolean> {
  const parents = [
    ...new Set(prepared.map((item) => path.dirname(item.target))),
  ];
  const results = await Promise.allSettled(
    parents.map((parent) => syncDirectory(parent)),
  );
  return results.every((result) => result.status === "fulfilled");
}

async function settleUncommittedWorkspaceProcessRollback(
  prepared: PreparedWorkspaceProcessRecoveryScope[],
  rollbackError: unknown,
  cancellationObserved: boolean,
): Promise<WorkspaceProcessRecoveryRestoreOutcome> {
  const cleanupTargets = prepared.flatMap((item) => [
    item.stage,
    item.displaced,
  ]);
  try {
    const durable =
      await cleanupWorkspaceProcessRollbackArtifacts(cleanupTargets);
    return {
      status: durable ? "reverted" : "indeterminate",
      restoredScopeCount: 0,
      durable,
      cancellationObserved,
      cleanupTargets,
      error: durable
        ? rollbackError
        : new Error(
            "Workspace Process rollback cleanup durability verification failed",
          ),
    };
  } catch (error) {
    return {
      status: "indeterminate",
      restoredScopeCount: 0,
      durable: false,
      cancellationObserved,
      cleanupTargets,
      error,
    };
  }
}

async function settleRevertedWorkspaceProcessRollback(
  prepared: PreparedWorkspaceProcessRecoveryScope[],
  reverted: boolean,
  syncParents: (
    prepared: PreparedWorkspaceProcessRecoveryScope[],
  ) => Promise<boolean>,
  rollbackError: unknown,
  cancellationObserved: boolean,
): Promise<WorkspaceProcessRecoveryRestoreOutcome> {
  const durable = reverted && (await syncParents(prepared));
  return {
    status: durable ? "reverted" : "indeterminate",
    restoredScopeCount: 0,
    durable,
    cancellationObserved,
    cleanupTargets: prepared.flatMap((item) => [item.stage, item.displaced]),
    error: durable
      ? rollbackError
      : new Error(
          "Workspace Process rollback reversal durability verification failed",
        ),
  };
}

async function removeRecoveryEntry(target: string): Promise<void> {
  const info = await lstat(target).catch(() => undefined);
  if (!info) return;
  if (!info.isDirectory() || info.isSymbolicLink()) {
    await unlink(target);
    return;
  }
  await chmod(target, 0o700);
  const children = await readdir(target, { withFileTypes: true });
  for (const child of children) {
    await removeRecoveryEntry(path.join(target, child.name));
  }
  await rmdir(target);
}

async function assertMissing(target: string): Promise<void> {
  if (await exists(target)) {
    throw new Error("Workspace Process rollback staging path already exists");
  }
}

async function exists(target: string): Promise<boolean> {
  return lstat(target).then(
    () => true,
    (error) => {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    },
  );
}
