import { canonicalJson, sha256 } from "./ed25519.js";
import { gitCommitArgumentsSha256 } from "./git-inspect-arguments.js";
import type { GitRepository, GitRepositoryState } from "./git-repository.js";
import type { PreparedGitCommit } from "./git-commit-private.js";
import {
  gitCommitDetailsSha256,
  gitCommitMessageEvidence,
  type GitCommitDetails,
} from "./git-commit-model.js";

export function createGitCommitDetails(input: {
  action: "preview" | "apply";
  status: GitCommitDetails["status"];
  postcondition: GitCommitDetails["postcondition"];
  previewId?: string;
  expiresAt?: string;
  message: string;
  branchRef: string;
  timestampSeconds: number;
  contextLines: number;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  prepared: PreparedGitCommit;
  afterHeadStateSha256?: string;
  sourcePreviewResultSha256?: string;
  refUpdateStatus?: GitCommitDetails["refUpdateStatus"];
  errorSha256?: string;
  durationMs?: number;
  environmentSha256?: string;
  resourceLimitsSha256?: string;
  durable: boolean;
  cancellationObserved: boolean;
}): GitCommitDetails {
  const core = {
    kind: "napier.git-commit" as const,
    schemaVersion: 1 as const,
    action: input.action,
    status: input.status,
    postcondition: input.postcondition,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...gitCommitMessageEvidence(input.message),
    branchRefSha256: sha256(input.branchRef),
    parentCommitSha1: input.prepared.parentCommitSha1,
    treeSha1: input.prepared.treeSha1,
    proposedCommitSha1: input.prepared.commitSha1,
    commitTimestampSeconds: input.timestampSeconds,
    identitySha256: input.prepared.identitySha256,
    contextLines: input.contextLines,
    ...input.prepared.counts,
    stagedPatchSha256: sha256(input.prepared.stagedPatch),
    stagedPatchBytes: Buffer.byteLength(input.prepared.stagedPatch, "utf8"),
    beforeRepositoryStateSha256: input.repositoryState.stateSha256,
    ...(input.afterHeadStateSha256
      ? { afterHeadStateSha256: input.afterHeadStateSha256 }
      : {}),
    ...(input.sourcePreviewResultSha256
      ? { sourcePreviewResultSha256: input.sourcePreviewResultSha256 }
      : {}),
    ...(input.refUpdateStatus
      ? { refUpdateStatus: input.refUpdateStatus }
      : {}),
    ...(input.errorSha256 ? { errorSha256: input.errorSha256 } : {}),
    runtimeEvidenceSha256: sha256(
      canonicalJson({
        sandboxSha256: input.prepared.sandboxSha256,
        executableSha256: input.prepared.executableSha256,
        argumentsSha256: gitCommitArgumentsSha256(
          input.repository,
          input.contextLines,
        ),
        environmentSha256:
          input.environmentSha256 ?? input.prepared.environmentSha256,
        resourceLimitsSha256:
          input.resourceLimitsSha256 ?? input.prepared.resourceLimitsSha256,
      }),
    ),
    durationMs: input.durationMs ?? input.prepared.durationMs,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
  };
  return { ...core, resultSha256: gitCommitDetailsSha256(core) };
}
