import { link, rename, unlink } from "node:fs/promises";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import {
  canonicalWorkspaceChangeRoot,
  cleanupWorkspaceChanges,
  currentWorkspaceChangeHash,
  assertWorkspaceChangeBeforeState,
  assertWorkspaceChangeMovedState,
  observeWorkspaceChanges,
  type PreparedWorkspaceChange,
  prepareWorkspaceChange,
  stageWorkspaceChange,
  syncWorkspaceChangeDirectories,
  workspaceChangeExpectedFile,
  workspaceChangeTarget,
} from "./workspace-change-files.js";
import {
  MAX_WORKSPACE_CHANGE_FILES,
  type WorkspaceChange,
  type WorkspaceChangeCommitOutcome,
  validateWorkspaceChanges,
  workspaceChangeOperationCounts,
  workspaceChangeSetSha256,
} from "./workspace-change-model.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export const WORKSPACE_CHANGE_COMMIT_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxFiles: MAX_WORKSPACE_CHANGE_FILES,
    maxFileBytes: MAX_LSP_DIAGNOSTIC_FILE_BYTES,
    targetStateRevalidation: "under_multi_path_lock_before_each_commit",
    staging: "same_directory_exclusive_temp_fsync",
    backup: "same_filesystem_hard_link_for_existing_files",
    additionInstall: "same_filesystem_hard_link_no_overwrite",
    deletion:
      "same_directory_tombstone_rename_with_inode_and_hash_verification",
    rollback: "reverse_order_restore_or_remove_and_state_verification",
    directoryFsync: true,
  }),
);

export interface CommitWorkspaceChangesOptions {
  workspaceRoot: string;
  dataRoot: string;
  sourcePreviewResultSha256: string;
  changes: WorkspaceChange[];
  signal?: AbortSignal;
  renameFile?: typeof rename;
  linkFile?: typeof link;
  unlinkFile?: typeof unlink;
}

export async function commitWorkspaceChanges(
  options: CommitWorkspaceChangesOptions,
): Promise<WorkspaceChangeCommitOutcome> {
  validateWorkspaceChanges(options.sourcePreviewResultSha256, options.changes);
  abort(options.signal, "Workspace change was aborted before lock");
  const workspaceRoot = await canonicalWorkspaceChangeRoot(
    options.workspaceRoot,
  );
  const targets = options.changes.map((change) =>
    workspaceChangeTarget(workspaceRoot, change.path),
  );
  const renameFile = options.renameFile ?? rename;
  const linkFile = options.linkFile ?? link;
  const unlinkFile = options.unlinkFile ?? unlink;
  return withWorkspacePathLocks(
    options.dataRoot,
    targets,
    "Workspace change",
    async () => {
      abort(options.signal, "Workspace change was aborted before staging");
      const prepared = await Promise.all(
        options.changes.map((change) =>
          prepareWorkspaceChange(workspaceRoot, change),
        ),
      );
      const expectedFiles = prepared.map(workspaceChangeExpectedFile);
      const planSha256 = sha256(
        canonicalJson({
          sourcePreviewResultSha256: options.sourcePreviewResultSha256,
          files: expectedFiles,
        }),
      );
      const beforeFileSetSha256 = workspaceChangeSetSha256(
        expectedFiles,
        "beforeSha256",
      );
      const expectedFileSetSha256 = workspaceChangeSetSha256(
        expectedFiles,
        "expectedSha256",
      );
      const staged: PreparedWorkspaceChange[] = [];
      const backups: PreparedWorkspaceChange[] = [];
      try {
        for (const change of prepared) {
          if (!change.output) continue;
          await stageWorkspaceChange(change);
          staged.push(change);
        }
        for (const change of prepared) {
          if (change.beforeSha256 === null) continue;
          await linkFile(change.target, change.backupPath!);
          backups.push(change);
        }
        if (!(await syncWorkspaceChangeDirectories(prepared))) {
          throw new Error(
            "Workspace change could not make backups durable before commit",
          );
        }
        abort(options.signal, "Workspace change was aborted before commit");
      } catch (error) {
        await cleanupWorkspaceChanges(staged, backups);
        throw error;
      }

      const committed: PreparedWorkspaceChange[] = [];
      let commitError: unknown;
      for (const change of prepared) {
        try {
          await assertWorkspaceChangeBeforeState(change);
          if (change.expectedSha256 === null) {
            await renameFile(change.target, change.temporaryPath!);
            committed.push(change);
            staged.push(change);
            await assertWorkspaceChangeMovedState(change);
          } else if (change.beforeSha256 === null) {
            await linkFile(change.temporaryPath!, change.target);
            committed.push(change);
            await unlinkFile(change.temporaryPath!);
          } else {
            await renameFile(change.temporaryPath!, change.target);
            committed.push(change);
          }
        } catch (error) {
          commitError = error;
          break;
        }
      }
      if (commitError) {
        return rollbackWorkspaceChanges({
          options,
          prepared,
          staged,
          backups,
          committed,
          renameFile,
          unlinkFile,
          planSha256,
          beforeFileSetSha256,
          expectedFileSetSha256,
          error: commitError,
        });
      }

      const observation = await observeWorkspaceChanges(prepared);
      const cleanup = await cleanupWorkspaceChanges(
        committed.filter((change) => change.expectedSha256 === null),
        backups,
      );
      const durable = await syncWorkspaceChangeDirectories(prepared);
      return {
        status: "applied",
        postcondition:
          observation.complete && observation.matchesExpected
            ? "verified"
            : observation.complete
              ? "drifted"
              : "indeterminate",
        ...commonOutcome(
          options,
          prepared,
          planSha256,
          beforeFileSetSha256,
          expectedFileSetSha256,
        ),
        committedFileCount: committed.length,
        restoredFileCount: 0,
        recoveryArtifactCount: cleanup.remainingArtifactCount,
        rollbackAttempted: false,
        rollbackVerified: false,
        durable: durable && cleanup.complete,
        cancellationObserved: options.signal?.aborted === true,
        ...(observation.fileSetSha256
          ? { observedFileSetSha256: observation.fileSetSha256 }
          : {}),
      };
    },
  );
}

async function rollbackWorkspaceChanges(input: {
  options: CommitWorkspaceChangesOptions;
  prepared: PreparedWorkspaceChange[];
  staged: PreparedWorkspaceChange[];
  backups: PreparedWorkspaceChange[];
  committed: PreparedWorkspaceChange[];
  renameFile: typeof rename;
  unlinkFile: typeof unlink;
  planSha256: string;
  beforeFileSetSha256: string;
  expectedFileSetSha256: string;
  error: unknown;
}): Promise<WorkspaceChangeCommitOutcome> {
  const restored = new Set<PreparedWorkspaceChange>();
  let rollbackError: unknown;
  for (const change of input.committed.slice().reverse()) {
    try {
      if (change.beforeSha256 === null) {
        if (
          (await currentWorkspaceChangeHash(change.target)) !==
          change.expectedSha256
        ) {
          throw new Error(
            "Workspace change added file drifted before rollback",
          );
        }
        await input.unlinkFile(change.target);
      } else {
        await input.renameFile(change.backupPath!, change.target);
      }
      restored.add(change);
    } catch (error) {
      rollbackError ??= error;
    }
  }
  const committed = new Set(input.committed);
  const disposableBackups = input.backups.filter(
    (change) => !committed.has(change) || restored.has(change),
  );
  const cleanup = await cleanupWorkspaceChanges(
    input.staged,
    disposableBackups,
  );
  const observation = await observeWorkspaceChanges(input.prepared);
  const rollbackVerified =
    !rollbackError && observation.complete && observation.matchesBefore;
  const durable = await syncWorkspaceChangeDirectories(input.prepared);
  return {
    status: rollbackVerified ? "rolled_back" : "indeterminate",
    postcondition: rollbackVerified ? "verified" : "indeterminate",
    ...commonOutcome(
      input.options,
      input.prepared,
      input.planSha256,
      input.beforeFileSetSha256,
      input.expectedFileSetSha256,
    ),
    committedFileCount: input.committed.length,
    restoredFileCount: restored.size,
    recoveryArtifactCount:
      input.committed.length - restored.size + cleanup.remainingArtifactCount,
    rollbackAttempted: true,
    rollbackVerified,
    durable: durable && cleanup.complete,
    cancellationObserved: input.options.signal?.aborted === true,
    ...(observation.fileSetSha256
      ? { observedFileSetSha256: observation.fileSetSha256 }
      : {}),
    errorSha256: sha256(errorMessage(rollbackError ?? input.error)),
  };
}

function commonOutcome(
  options: CommitWorkspaceChangesOptions,
  prepared: PreparedWorkspaceChange[],
  planSha256: string,
  beforeFileSetSha256: string,
  expectedFileSetSha256: string,
): Omit<
  WorkspaceChangeCommitOutcome,
  | "status"
  | "postcondition"
  | "committedFileCount"
  | "restoredFileCount"
  | "recoveryArtifactCount"
  | "rollbackAttempted"
  | "rollbackVerified"
  | "durable"
  | "cancellationObserved"
  | "observedFileSetSha256"
  | "errorSha256"
> {
  return {
    sourcePreviewResultSha256: options.sourcePreviewResultSha256,
    planSha256,
    fileCount: prepared.length,
    ...workspaceChangeOperationCounts(options.changes),
    beforeFileSetSha256,
    expectedFileSetSha256,
    resourceLimitsSha256: WORKSPACE_CHANGE_COMMIT_LIMITS_SHA256,
    expectedFiles: prepared.map(workspaceChangeExpectedFile),
  };
}

function abort(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted) throw new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
