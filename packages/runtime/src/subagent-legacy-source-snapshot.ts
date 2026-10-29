import { readWorktreeSnapshot } from "./subagent-worktree-snapshot.js";
import type { WorktreePreviewSource } from "./subagent-worktree-mutation-model.js";

/** Old publication anchors the full baseline, but not the capsule's read set. */
export async function assertLegacySourceSnapshot(source: WorktreePreviewSource, signal?: AbortSignal): Promise<void> {
  const snapshot = await readWorktreeSnapshot(source.sourceRoot, { ...(signal ? { signal } : {}) });
  if (snapshot.contentSha256 !== source.sourceSnapshotSha256 || snapshot.fileCount !== source.sourceFileCount ||
      snapshot.bytes !== source.sourceBytes)
    throw new Error("Legacy candidate requires its complete original source snapshot; retained for inspection");
}
