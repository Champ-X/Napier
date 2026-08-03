import { canonicalJson, sha256 } from "./ed25519.js";
import { gitReviewArgumentsSha256 } from "./git-review-arguments.js";
import {
  gitReviewDetailsSha256,
  type GitReviewDetails,
  type GitReviewPlan,
  type GitReviewProcessEvidence,
} from "./git-review-model.js";
import type { GitRepository, GitRepositoryState } from "./git-repository.js";

export function createGitReviewDetails(input: {
  action: "preview" | "apply";
  status: GitReviewDetails["status"];
  postcondition: GitReviewDetails["postcondition"];
  previewId?: string;
  expiresAt?: string;
  sourceBranchName: string;
  targetBranchName: string;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  plan: GitReviewPlan;
  evidence: GitReviewProcessEvidence;
  afterRepositoryStateSha256?: string;
  sourcePreviewResultSha256?: string;
  refUpdateStatus?: GitReviewDetails["refUpdateStatus"];
  errorSha256?: string;
  durable: boolean;
  cancellationObserved: boolean;
}): GitReviewDetails {
  const core = {
    kind: "napier.git-review" as const,
    schemaVersion: 1 as const,
    action: input.action,
    status: input.status,
    postcondition: input.postcondition,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    sourceBranchRefSha256: input.plan.sourceBranchRefSha256,
    targetBranchRefSha256: input.plan.targetBranchRefSha256,
    sourceBranchNameBytes: Buffer.byteLength(input.sourceBranchName, "utf8"),
    targetBranchNameBytes: Buffer.byteLength(input.targetBranchName, "utf8"),
    sourceCommitSha1: input.plan.sourceCommitSha1,
    targetCommitSha1: input.plan.targetCommitSha1,
    commitCount: input.plan.commitCount,
    ...input.plan.counts,
    patchSha256: input.plan.patchSha256,
    patchBytes: input.plan.patchBytes,
    reviewPlanSha256: input.plan.planSha256,
    beforeRepositoryStateSha256: input.repositoryState.stateSha256,
    ...(input.afterRepositoryStateSha256
      ? { afterRepositoryStateSha256: input.afterRepositoryStateSha256 }
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
        sandboxSha256: input.evidence.sandboxSha256,
        executableSha256: input.evidence.executableSha256,
        argumentsSha256: gitReviewArgumentsSha256(input.repository),
        environmentSha256: input.evidence.environmentSha256,
        resourceLimitsSha256: input.evidence.resourceLimitsSha256,
      }),
    ),
    durationMs: input.evidence.durationMs,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
  };
  return { ...core, resultSha256: gitReviewDetailsSha256(core) };
}
