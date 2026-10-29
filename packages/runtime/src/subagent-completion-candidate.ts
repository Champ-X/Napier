import type { SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { candidateSourceSha256, SubagentCandidateStore } from "./subagent-candidate-store.js";
import { completionReservationIdentity } from "./subagent-completion-receipt.js";
import type { SubagentWorktreePreview } from "./subagent-worktree-mutation-model.js";
import { createSubagentWorktreeReview } from "./subagent-worktree-review.js";
import { normalizeSubagentWorktreePath } from "./subagent-worktree-files.js";

export async function readSubagentCompletionCandidate(options: { dataRoot: string; workspaceRoot: string }, task: SubagentTask,
  requireUnrevoked = false): Promise<SubagentWorktreePreview | undefined> {
  const reservation = task.completion?.reservation ?? task.completionReservation;
  const reference = reservation?.candidate;
  if (!reference) return undefined;
  const { source, expiresAt, state } = await new SubagentCandidateStore(options).inspect(reference.id);
  const writePaths = (task.writePaths ?? []).map(normalizeSubagentWorktreePath).sort();
  if (task.role !== "coder" || source.writeScopeCount !== writePaths.length ||
      source.writeScopeSetSha256 !== sha256(canonicalJson(writePaths.map((entry) => sha256(entry)))) ||
      source.changes.some((change) => !writePaths.includes(change.path)) ||
      !source.completion || completionReservationIdentity(source.completion) !== completionReservationIdentity(reservation!) ||
      reference.sourceSha256 !== candidateSourceSha256(source) || source.taskId !== reservation!.producerTaskId ||
      source.outcomeSha256 !== (task.outcome?.contentSha256 ?? sha256(canonicalJson(task.output))) ||
      !source.candidateVerification || !source.candidateCommands || (requireUnrevoked && state))
    throw new Error("Subagent immutable candidate completion binding changed or was revoked");
  const review = createSubagentWorktreeReview(source.changes);
  return { id: reference.id, expiresAt, taskId: source.taskId,
    changedPaths: source.changes.map((change) => change.path), changedFileCount: source.changes.length,
    changedFileSetSha256: source.changedFileSetSha256, addedFileCount: source.addedFileCount,
    modifiedFileCount: source.modifiedFileCount, deletedFileCount: source.deletedFileCount,
    renamedFileCount: source.renamedFileCount, sourceSnapshotSha256: source.sourceSnapshotSha256,
    review: review.text, reviewTruncated: review.truncated,
    candidateVerification: source.candidateVerification, candidateCommands: source.candidateCommands,
    ...(source.candidateToolchainSha256 ? { candidateToolchainSha256: source.candidateToolchainSha256 } : {}) };
}
