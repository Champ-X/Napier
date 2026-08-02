import { sha256 } from "./ed25519.js";
import type { GitCommitDetails } from "./git-commit-model.js";
import type { PreparedGitCommit } from "./git-commit-private.js";
import {
  readGitIndexBytes,
  snapshotGitRepository,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";

export async function assertGitCommitPreviewState(
  repository: GitRepository,
  expected: GitRepositoryState,
  branchRef: string,
): Promise<void> {
  const current = await snapshotGitRepository(repository);
  if (
    current.stateSha256 !== expected.stateSha256 ||
    current.currentRef !== branchRef
  ) {
    throw new Error("Git commit preview is stale; preview the commit again");
  }
}

export async function boundGitCommitIndexBytes(
  repository: GitRepository,
  expected: GitRepositoryState,
): Promise<Buffer> {
  const value = await readGitIndexBytes(repository);
  if (!value || sha256(value) !== expected.index.sha256) {
    throw new Error("Git index changed while commit was inspected");
  }
  return value;
}

export function assertPreparedGitCommitMatches(
  prepared: PreparedGitCommit,
  preview: {
    details: GitCommitDetails;
  },
): void {
  if (
    prepared.parentCommitSha1 !== preview.details.parentCommitSha1 ||
    prepared.treeSha1 !== preview.details.treeSha1 ||
    prepared.commitSha1 !== preview.details.proposedCommitSha1 ||
    sha256(prepared.stagedPatch) !== preview.details.stagedPatchSha256
  ) {
    throw new Error("Git commit preview is stale; preview the commit again");
  }
}

export function requireGitCurrentBranch(state: GitRepositoryState): string {
  if (!state.index.present) {
    throw new Error("Git commit requires an existing repository index");
  }
  if (!state.currentRef?.startsWith("refs/heads/")) {
    throw new Error("Git commit requires an attached local branch");
  }
  return state.currentRef;
}
