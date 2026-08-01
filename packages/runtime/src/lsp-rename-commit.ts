import { link, rename, unlink } from "node:fs/promises";

import type { LspRenameApplyDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  lspRenameExpectedFiles,
  lspRenameWorkspaceChanges,
  type LspRenameCommitExpectedFile,
} from "./lsp-rename-commit-files.js";
import { validateLspRenameCommitInput } from "./lsp-rename-commit-model.js";
import { MAX_LSP_DIAGNOSTIC_FILE_BYTES } from "./lsp-diagnostics.js";
import {
  commitWorkspaceChanges,
  type CommitWorkspaceChangesOptions,
} from "./workspace-change-commit.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";

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
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
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
  unlinkFile?: typeof unlink;
}

export async function commitLspRename(
  options: CommitLspRenameOptions,
): Promise<LspRenameCommitOutcome> {
  validateLspRenameCommitInput(
    options.sourcePreviewResultSha256,
    options.files,
  );
  if (options.signal?.aborted) {
    throw new Error("LSP rename apply was aborted before lock");
  }
  const changes = await lspRenameWorkspaceChanges(
    options.workspaceRoot,
    options.files,
  );
  const outcome = await commitWorkspaceChanges({
    workspaceRoot: options.workspaceRoot,
    dataRoot: options.dataRoot,
    sourcePreviewResultSha256: options.sourcePreviewResultSha256,
    changes,
    ...(options.signal ? { signal: options.signal } : {}),
    ...commitOptions(options),
  });
  return {
    ...outcome,
    editCount: options.files.reduce(
      (total, file) => total + file.edits.length,
      0,
    ),
    resourceLimitsSha256: LSP_RENAME_APPLY_LIMITS_SHA256,
    expectedFiles: lspRenameExpectedFiles(outcome.expectedFiles),
  };
}

function commitOptions(
  options: CommitLspRenameOptions,
): Pick<
  CommitWorkspaceChangesOptions,
  "renameFile" | "linkFile" | "unlinkFile"
> {
  return {
    ...(options.renameFile ? { renameFile: options.renameFile } : {}),
    ...(options.linkFile ? { linkFile: options.linkFile } : {}),
    ...(options.unlinkFile ? { unlinkFile: options.unlinkFile } : {}),
  };
}
