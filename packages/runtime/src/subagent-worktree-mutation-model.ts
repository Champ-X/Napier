import type { SubagentWorktreeApplyDetails } from "@napier/contracts";

import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import type { LspWorkspaceEditPreviewSource } from "./lsp-workspace-edit-mutation.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";

export interface WorktreePreviewSource extends LspWorkspaceEditPreviewSource {
  taskId: string;
  outcomeSha256: string;
  sourceRoot: string;
  sourceSnapshotSha256: string;
  sourceFileCount: number;
  sourceBytes: number;
  writeScopeCount: number;
  writeScopeSetSha256: string;
  changedFileSetSha256: string;
  candidateVerificationAttemptCount: number;
  candidateVerificationFreshCount: number;
  candidateVerificationPassedCount: number;
  candidateVerificationFailedCount: number;
  candidateVerificationStaleCount: number;
  candidateVerificationSetSha256: string;
  candidateCommandAttemptCount: number;
  candidateCommandFreshCount: number;
  candidateCommandSucceededCount: number;
  candidateCommandFailedCount: number;
  candidateCommandStaleCount: number;
  candidateCommandSetSha256: string;
  candidateToolchainSha256?: string;
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  changes: SubagentWorktreeChange[];
  files: LspRenameFile[];
}

export interface SubagentWorktreeApplyResult {
  details: SubagentWorktreeApplyDetails;
  summary: string;
}

export interface SubagentWorktreeApplyManager {
  apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeApplyResult>;
}
