import { link, rename } from "node:fs/promises";

import type { LspRenameApplyDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  canonicalLspRenameWorkspaceRoot,
  cleanupLspRenameFiles,
  lspRenameCommitReceipt,
  type LspRenameCommitExpectedFile,
  lspRenameExpectedFile,
  lspRenameLockTarget,
  observeLspRenameFiles,
  type PreparedLspRenameFile,
  prepareLspRenameFile,
  readLspRenameCurrentHash,
  stageLspRenameFile,
  syncLspRenameDirectories,
} from "./lsp-rename-commit-files.js";
import { validateLspRenameCommitInput } from "./lsp-rename-commit-model.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import { withWorkspacePathLocks } from "./workspace-write-lock.js";

export type { LspRenameCommitExpectedFile } from "./lsp-rename-commit-files.js";

export const LSP_RENAME_APPLY_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxFiles: 32,
    maxEdits: 256,
    maxFileBytes: MAX_LSP_DIAGNOSTIC_FILE_BYTES,
    targetHashRevalidation: "under_multi_path_lock_before_each_commit",
    staging: "same_directory_exclusive_temp_fsync",
    backup: "same_filesystem_hard_link",
    rollback: "reverse_order_backup_rename_and_hash_verification",
    directoryFsync: true,
  }),
);

export interface LspRenameCommitOutcome extends Omit<
  LspRenameApplyDetails,
  "kind" | "schemaVersion" | "diagnostics" | "resultSha256"
> {
  expectedFiles: LspRenameCommitExpectedFile[];
}

export interface CommitLspRenameOptions {
  workspaceRoot: string;
  dataRoot: string;
  sourcePreviewResultSha256: string;
  files: LspRenameFile[];
  signal?: AbortSignal;
  renameFile?: typeof rename;
  linkFile?: typeof link;
}

export async function commitLspRename(
  options: CommitLspRenameOptions,
): Promise<LspRenameCommitOutcome> {
  validateLspRenameCommitInput(
    options.sourcePreviewResultSha256,
    options.files,
  );
  assertNotAborted(options.signal, "LSP rename apply was aborted before lock");
  const workspaceRoot = await canonicalLspRenameWorkspaceRoot(
    options.workspaceRoot,
  );
  const lockTargets = options.files.map((file) =>
    lspRenameLockTarget(workspaceRoot, file.path),
  );
  const renameFile = options.renameFile ?? rename;
  const linkFile = options.linkFile ?? link;
  return withWorkspacePathLocks(
    options.dataRoot,
    lockTargets,
    "LSP rename apply",
    async () => {
      assertNotAborted(
        options.signal,
        "LSP rename apply was aborted before staging",
      );
      const prepared = await Promise.all(
        options.files.map((file) => prepareLspRenameFile(workspaceRoot, file)),
      );
      const planSha256 = sha256(
        canonicalJson(
          lspRenameCommitReceipt(options.sourcePreviewResultSha256, prepared),
        ),
      );
      const beforeFileSetSha256 = fileSetSha256(prepared, "beforeSha256");
      const expectedFileSetSha256 = fileSetSha256(prepared, "expectedSha256");
      const staged: PreparedLspRenameFile[] = [];
      const backups: PreparedLspRenameFile[] = [];
      const committed: PreparedLspRenameFile[] = [];
      try {
        for (const file of prepared) {
          await stageLspRenameFile(file);
          staged.push(file);
        }
        for (const file of prepared) {
          await linkFile(file.target, file.backupPath);
          backups.push(file);
        }
        if (!(await syncLspRenameDirectories(prepared))) {
          throw new Error(
            "LSP rename apply could not make backups durable before commit",
          );
        }
        assertNotAborted(
          options.signal,
          "LSP rename apply was aborted before commit",
        );
      } catch (error) {
        await cleanupLspRenameFiles(staged, backups);
        throw error;
      }

      let commitError: unknown;
      for (const file of prepared) {
        try {
          if (
            (await readLspRenameCurrentHash(file.target)) !== file.beforeSha256
          ) {
            throw new Error(
              "LSP rename apply target changed before coordinated commit",
            );
          }
          await renameFile(file.temporaryPath, file.target);
          committed.push(file);
        } catch (error) {
          commitError = error;
          break;
        }
      }
      if (commitError) {
        return rollbackCommit({
          options,
          prepared,
          staged,
          backups,
          committed,
          renameFile,
          planSha256,
          beforeFileSetSha256,
          expectedFileSetSha256,
          error: commitError,
        });
      }

      const observation = await observeLspRenameFiles(prepared);
      const cleanup = await cleanupLspRenameFiles([], backups);
      const durable = await syncLspRenameDirectories(prepared);
      const postcondition =
        observation.complete && observation.matchesExpected
          ? "verified"
          : observation.complete
            ? "drifted"
            : "indeterminate";
      return {
        status: "applied",
        postcondition,
        ...commonOutcome(
          options,
          prepared,
          planSha256,
          beforeFileSetSha256,
          expectedFileSetSha256,
        ),
        committedFileCount: committed.length,
        restoredFileCount: 0,
        recoveryArtifactCount: cleanup.remainingBackupCount,
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

async function rollbackCommit(input: {
  options: CommitLspRenameOptions;
  prepared: PreparedLspRenameFile[];
  staged: PreparedLspRenameFile[];
  backups: PreparedLspRenameFile[];
  committed: PreparedLspRenameFile[];
  renameFile: typeof rename;
  planSha256: string;
  beforeFileSetSha256: string;
  expectedFileSetSha256: string;
  error: unknown;
}): Promise<LspRenameCommitOutcome> {
  const restored = new Set<PreparedLspRenameFile>();
  let rollbackError: unknown;
  for (const file of input.committed.slice().reverse()) {
    try {
      await input.renameFile(file.backupPath, file.target);
      restored.add(file);
    } catch (error) {
      rollbackError ??= error;
    }
  }
  const committed = new Set(input.committed);
  const disposableBackups = input.backups.filter(
    (file) => !committed.has(file) || restored.has(file),
  );
  const cleanup = await cleanupLspRenameFiles(input.staged, disposableBackups);
  const observation = await observeLspRenameFiles(input.prepared);
  const rollbackVerified =
    !rollbackError && observation.complete && observation.matchesBefore;
  const durable = await syncLspRenameDirectories(input.prepared);
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
      input.committed.length - restored.size + cleanup.remainingBackupCount,
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
  options: CommitLspRenameOptions,
  prepared: PreparedLspRenameFile[],
  planSha256: string,
  beforeFileSetSha256: string,
  expectedFileSetSha256: string,
): Pick<
  LspRenameCommitOutcome,
  | "sourcePreviewResultSha256"
  | "planSha256"
  | "fileCount"
  | "editCount"
  | "beforeFileSetSha256"
  | "expectedFileSetSha256"
  | "resourceLimitsSha256"
  | "expectedFiles"
> {
  return {
    sourcePreviewResultSha256: options.sourcePreviewResultSha256,
    planSha256,
    fileCount: prepared.length,
    editCount: options.files.reduce(
      (total, file) => total + file.edits.length,
      0,
    ),
    beforeFileSetSha256,
    expectedFileSetSha256,
    resourceLimitsSha256: LSP_RENAME_APPLY_LIMITS_SHA256,
    expectedFiles: prepared.map(lspRenameExpectedFile),
  };
}

function fileSetSha256(
  files: PreparedLspRenameFile[],
  field: "beforeSha256" | "expectedSha256",
): string {
  return sha256(
    canonicalJson(
      files.map((file) => ({
        pathSha256: file.pathSha256,
        fileSha256: file[field],
      })),
    ),
  );
}

function assertNotAborted(
  signal: AbortSignal | undefined,
  message: string,
): void {
  if (signal?.aborted) throw new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
