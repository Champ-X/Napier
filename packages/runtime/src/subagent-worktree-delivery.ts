import { canonicalJson, sha256 } from "./ed25519.js";
import { rethrowAfterCandidateRevocation, SubagentCandidateStore } from "./subagent-candidate-store.js";
export { rethrowAfterCandidateRevocation } from "./subagent-candidate-store.js";
import { readWorktreeBaseline } from "./subagent-worktree-baseline.js";
import {
  subagentWorktreeModifiedLspFiles,
  type SubagentWorktreeCandidate,
} from "./subagent-worktree-diff.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-snapshot.js";
import { prepareWorktreeMerge } from "./subagent-worktree-merge.js";
import type {
  WorktreePreviewSource,
  SubagentWorktreePreview,
} from "./subagent-worktree-mutation-model.js";
import { worktreeReadDependencies } from "./subagent-worktree-read-set.js";
import { createSubagentWorktreeReview } from "./subagent-worktree-review.js";
import type { SubagentWorktreeToolchain } from "./subagent-worktree-toolchain.js";
import type {
  SubagentCandidateCommandSummary,
  SubagentCandidateVerificationSummary,
} from "./subagent-worktree-verification.js";
import type { PreparedSubagentCompletion, SubagentCandidateDeliveryAuthority } from "./subagent-completion-types.js";
import type { LegacyCandidateMigrationAuthority } from "./subagent-candidate-legacy-capability.js";

export class SubagentWorktreeDelivery extends SubagentCandidateStore {
  constructor(
    private readonly deliveryOptions: {
      workspaceRoot: string;
      dataRoot: string;
      now?: () => Date;
      candidateDeliveryAuthority?: SubagentCandidateDeliveryAuthority;
      legacyCandidateAuthority?: LegacyCandidateMigrationAuthority;
      requireCompletionBinding?: boolean;
    },
  ) {
    super(deliveryOptions);
  }

  prepare(source: WorktreePreviewSource, signal?: AbortSignal): Promise<void> {
    return prepareWorktreeMerge(source, this.deliveryOptions.dataRoot, signal);
  }

  async deliver(
    session: SubagentWorktreeSession,
    outcomeSha256: string,
    candidate: SubagentWorktreeCandidate,
    candidateVerification: SubagentCandidateVerificationSummary,
    candidateCommands: SubagentCandidateCommandSummary,
    toolchain?: SubagentWorktreeToolchain,
    signal?: AbortSignal,
    prepared?: PreparedSubagentCompletion,
  ): Promise<SubagentWorktreePreview> {
    signal?.throwIfAborted();
    const readDependencies = worktreeReadDependencies(
      await readWorktreeBaseline(session),
      session.readScopes,
      candidate.changedPaths,
    );
    const review = createSubagentWorktreeReview(candidate.changes);
    const modifiedFiles = subagentWorktreeModifiedLspFiles(candidate.changes);
    signal?.throwIfAborted();
    const receipt = {
      taskId: session.taskId,
      outcomeSha256,
      readDependencies,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      sourceFileCount: session.sourceFileCount,
      sourceBytes: session.sourceBytes,
      writeScopeCount: session.writePaths.length,
      writeScopeSetSha256: session.writeScopeSetSha256,
      changedFileCount: candidate.changes.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
      addedFileCount: candidate.addedFileCount,
      modifiedFileCount: candidate.modifiedFileCount,
      deletedFileCount: candidate.deletedFileCount,
      renamedFileCount: candidate.renamedFileCount,
      candidateVerificationAttemptCount: candidateVerification.attemptCount,
      candidateVerificationFreshCount: candidateVerification.freshCount,
      candidateVerificationPassedCount: candidateVerification.passedCount,
      candidateVerificationFailedCount: candidateVerification.failedCount,
      candidateVerificationStaleCount: candidateVerification.staleCount,
      candidateVerificationSetSha256: candidateVerification.setSha256,
      candidateCommandAttemptCount: candidateCommands.attemptCount,
      candidateCommandFreshCount: candidateCommands.freshCount,
      candidateCommandSucceededCount: candidateCommands.succeededCount,
      candidateCommandFailedCount: candidateCommands.failedCount,
      candidateCommandStaleCount: candidateCommands.staleCount,
      candidateCommandSetSha256: candidateCommands.setSha256,
      ...(toolchain
        ? { candidateToolchainSha256: toolchain.contentSha256 }
        : {}),
    };
    const stored = await this.store({
      ...receipt,
      sourcePreviewResultSha256: sha256(canonicalJson(receipt)),
      sourceRoot: session.sourceRoot,
      changes: candidate.changes,
      files: modifiedFiles,
      ...(prepared ? { candidateVerification, candidateCommands } : {}),
    }, prepared);
    try {
      signal?.throwIfAborted();
    } catch (error) {
      if (!stored.cleanupOwned) throw error;
      return rethrowAfterCandidateRevocation(error, () =>
        this.revokeUndelivered(stored.id, session.taskId),
      );
    }
    return {
      id: stored.id,
      cleanupOwned: stored.cleanupOwned,
      expiresAt: stored.expiresAt,
      taskId: session.taskId,
      changedPaths: candidate.changedPaths,
      changedFileCount: candidate.changes.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
      addedFileCount: candidate.addedFileCount,
      modifiedFileCount: candidate.modifiedFileCount,
      deletedFileCount: candidate.deletedFileCount,
      renamedFileCount: candidate.renamedFileCount,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      review: review.text,
      reviewTruncated: review.truncated,
      candidateVerification,
      candidateCommands,
      ...(toolchain
        ? { candidateToolchainSha256: toolchain.contentSha256 }
        : {}),
    };
  }
}
