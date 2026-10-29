export type { PreparedSubagentCompletion, SubagentCandidateDeliveryAuthority } from "./subagent-completion-types.js";
import type {
  SubagentCandidateCommandSummary,
  SubagentCandidateVerificationSummary,
} from "./subagent-worktree-verification.js";
import type { SubagentCompletionReservation, SubagentWorktreeApplyDetails } from "@napier/contracts";

import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import type { LspWorkspaceEditPreviewSource } from "./lsp-workspace-edit-mutation.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";
import type { WorktreeReadDependency } from "./subagent-worktree-read-set.js";

export interface WorktreePreviewSource extends LspWorkspaceEditPreviewSource {
  /** Host-only constraint, never persisted in a candidate capsule. */
  legacySourceSnapshotRequired?: boolean;
  completion?: SubagentCompletionReservation;
  candidateVerification?: SubagentCandidateVerificationSummary;
  candidateCommands?: SubagentCandidateCommandSummary;
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
  readDependencies: WorktreeReadDependency[];
  mergePrepared?: boolean;
  candidateId?: string;
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

export interface SubagentWorktreePreview {
  /** Only the first staging caller may retract an uncommitted object. */
  cleanupOwned?: boolean;
  id: string;
  expiresAt: string;
  taskId: string;
  changedPaths: string[];
  changedFileCount: number;
  changedFileSetSha256: string;
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  sourceSnapshotSha256: string;
  review: string;
  reviewTruncated: boolean;
  candidateVerification: SubagentCandidateVerificationSummary;
  candidateCommands: SubagentCandidateCommandSummary;
  candidateToolchainSha256?: string;
}
