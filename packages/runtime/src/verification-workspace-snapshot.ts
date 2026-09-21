import {
  digestVerificationWorkspace,
  type VerificationWorkspaceDigest,
} from "./verification-workspace-digest.js";
import type { VerificationStatus } from "./verification-types.js";

export async function captureVerificationWorkspace(
  root: string,
  signal?: AbortSignal,
) {
  try {
    return await digestVerificationWorkspace(root, signal ? { signal } : {});
  } catch (error) {
    if (signal?.aborted) throw new Error("verification was aborted");
    throw error;
  }
}

/** CWD selects execution, not the dependency boundary. A check may import files
 * elsewhere in the workspace; incomplete or changing evidence cannot attest a
 * stable pass. This is an optimistic before/after check, not a filesystem lock. */
export async function settleVerificationWorkspace(
  root: string,
  before: VerificationWorkspaceDigest,
  executionStatus: VerificationStatus,
  signal?: AbortSignal,
) {
  const after = await captureVerificationWorkspace(root, signal);
  const snapshotStatus =
    before.truncated || after.truncated
      ? ("indeterminate" as const)
      : before.sha256 === after.sha256
        ? ("unchanged" as const)
        : ("changed" as const);
  return {
    status:
      executionStatus === "passed" && snapshotStatus !== "unchanged"
        ? ("failed" as const)
        : executionStatus,
    workspaceSnapshotScope: "workspace" as const,
    observedWorkspaceSnapshotSha256: after.sha256,
    workspaceSnapshotTruncated: before.truncated || after.truncated,
    snapshotStatus,
  };
}
