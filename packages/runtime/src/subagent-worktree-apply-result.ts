import type { SubagentWorktreeApplyDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LspRenameDiagnosticsObservation } from "./lsp-rename-apply-diagnostics.js";
import {
  formatLspWorkspaceEditApplySummary,
  type LspWorkspaceEditMutationExecution,
} from "./lsp-workspace-edit-mutation.js";
import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";

export function createSubagentWorktreeApplyResult(
  execution: LspWorkspaceEditMutationExecution<
    WorktreePreviewSource,
    LspRenameDiagnosticsObservation
  >,
): { details: SubagentWorktreeApplyDetails; summary: string } {
  const {
    expectedFiles: _expectedFiles,
    addedFileCount: _addedFileCount,
    modifiedFileCount: _modifiedFileCount,
    deletedFileCount: _deletedFileCount,
    ...durableOutcome
  } = execution.outcome;
  const base = {
    kind: "napier.subagent-worktree-apply" as const,
    schemaVersion: 1 as const,
    ...durableOutcome,
    taskId: execution.source.taskId,
    outcomeSha256: execution.source.outcomeSha256,
    sourceSnapshotSha256: execution.source.sourceSnapshotSha256,
    sourceFileCount: execution.source.sourceFileCount,
    sourceBytes: execution.source.sourceBytes,
    writeScopeCount: execution.source.writeScopeCount,
    writeScopeSetSha256: execution.source.writeScopeSetSha256,
    changedFileSetSha256: execution.source.changedFileSetSha256,
    candidateAddedFileCount: execution.source.addedFileCount,
    candidateModifiedFileCount: execution.source.modifiedFileCount,
    candidateDeletedFileCount: execution.source.deletedFileCount,
    candidateRenamedFileCount: execution.source.renamedFileCount,
    candidateVerificationAttemptCount:
      execution.source.candidateVerificationAttemptCount,
    candidateVerificationFreshCount:
      execution.source.candidateVerificationFreshCount,
    candidateVerificationPassedCount:
      execution.source.candidateVerificationPassedCount,
    candidateVerificationFailedCount:
      execution.source.candidateVerificationFailedCount,
    candidateVerificationStaleCount:
      execution.source.candidateVerificationStaleCount,
    candidateVerificationSetSha256:
      execution.source.candidateVerificationSetSha256,
    candidateCommandAttemptCount: execution.source.candidateCommandAttemptCount,
    candidateCommandFreshCount: execution.source.candidateCommandFreshCount,
    candidateCommandSucceededCount:
      execution.source.candidateCommandSucceededCount,
    candidateCommandFailedCount: execution.source.candidateCommandFailedCount,
    candidateCommandStaleCount: execution.source.candidateCommandStaleCount,
    candidateCommandSetSha256: execution.source.candidateCommandSetSha256,
    ...(execution.source.candidateToolchainSha256
      ? {
          candidateToolchainSha256: execution.source.candidateToolchainSha256,
        }
      : {}),
    ...(execution.diagnostics
      ? { diagnostics: execution.diagnostics.details }
      : {}),
    ...(execution.tests ? { tests: execution.tests.details } : {}),
  };
  const details: SubagentWorktreeApplyDetails = {
    ...base,
    resultSha256: sha256(canonicalJson(base)),
  };
  return {
    details,
    summary: formatLspWorkspaceEditApplySummary({
      label: "Subagent worktree apply",
      details,
      ...(execution.diagnostics
        ? { diagnosticsSummary: execution.diagnostics.summary }
        : {}),
      ...(execution.tests ? { testsSummary: execution.tests.summary } : {}),
      appliedMessage:
        "The reviewed coder candidate is committed. Diagnostics and related-test evidence above describe the merged workspace.",
      rolledBackMessage:
        "The candidate commit failed and every changed file was restored. Delegate or preview again before retrying.",
      indeterminateMessage:
        "Workspace state is indeterminate. Inspect every candidate path before another write.",
    }),
  };
}
