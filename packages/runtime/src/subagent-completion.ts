import { rethrowAfterCandidateRevocation, unresolvedCandidateCleanup } from "./subagent-candidate-store.js";
import type { SubagentWorktreePreview } from "./subagent-worktree-mutation-model.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-snapshot.js";

export interface CandidateDeliveryPort {
  storePreview(
    session: SubagentWorktreeSession,
    outcomeSha256: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreePreview>;
  revokePreview(previewId: string, taskId: string): Promise<boolean>;
}

/** Own the candidate until the queued durable completion mutation commits. */
export async function completeSubagentTask<T>(input: {
  taskId: string;
  outcomeSha256: string;
  worktree?: SubagentWorktreeSession;
  worktrees?: CandidateDeliveryPort;
  signal?: AbortSignal;
  assertActive: () => void;
  isCommitted?: () => boolean | Promise<boolean>;
  finish: (
    preview: SubagentWorktreePreview | undefined,
    assertActive: () => void,
  ) => Promise<T>;
}): Promise<{ value: T; preview?: SubagentWorktreePreview }> {
  const assertActive = () => {
    input.assertActive();
    input.signal?.throwIfAborted();
  };
  let preview: SubagentWorktreePreview | undefined;
  try {
    assertActive();
    if (input.worktree) {
      if (!input.worktrees || input.worktree.taskId !== input.taskId)
        throw new Error("Subagent completion worktree task binding changed");
      preview = await input.worktrees.storePreview(
        input.worktree, input.outcomeSha256, input.signal,
      );
    }
    assertActive();
    // The callback must guard the serialized mutation with assertActive. It
    // must not emit public events: successful commit transfers candidate ownership.
    const value = await input.finish(preview, assertActive);
    return { value, ...(preview ? { preview } : {}) };
  } catch (error) {
    if (preview && input.worktrees) {
      let committed: boolean;
      try {
        committed = (await input.isCommitted?.()) ?? false;
      } catch (checkError) {
        throw unresolvedCandidateCleanup(error, checkError);
      }
      if (!committed)
        return rethrowAfterCandidateRevocation(error, () =>
          input.worktrees!.revokePreview(preview!.id, input.taskId),
        );
    }
    throw error;
  }
}
