import { canonicalJson, sha256 } from "./ed25519.js";
import { createGitReviewDetails } from "./git-review-details.js";
import {
  GIT_REVIEW_REFLOG_MESSAGE,
  type GitReviewDetails,
} from "./git-review-model.js";
import {
  gitReviewProcessEvidence,
  type PreparedGitReview,
} from "./git-review-prepare.js";
import { settleGitReviewPromotion } from "./git-review-settlement.js";
import type {
  GitInspectProcessOptions,
  GitInspectProcessResult,
} from "./git-inspect-process.js";
import type {
  GitBoundFile,
  GitRepository,
  GitRepositoryState,
} from "./git-repository.js";
import { syncGitBranchRefTransition } from "./git-ref-files.js";

interface GitReviewPromotionPreview {
  sourceBranchName: string;
  sourceBranchRef: string;
  targetBranchName: string;
  targetBranchRef: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  targetReflogState: GitBoundFile;
  details: GitReviewDetails;
}

export async function applyGitReviewPromotion(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: GitReviewPromotionPreview;
  prepared: PreparedGitReview;
  update?: GitInspectProcessResult;
  updateError?: unknown;
  deadline: number;
  signal?: AbortSignal;
}) {
  const updateClean =
    input.update?.status === "succeeded" &&
    input.update.stdout.length === 0 &&
    input.update.stderr.length === 0;
  const initial = await observePromotion(input);
  const promoted =
    initial.targetCommitSha1 === input.prepared.plan.sourceCommitSha1;
  const durable = promoted
    ? await syncGitBranchRefTransition({
        repository: input.repository,
        branchRef: input.preview.targetBranchRef,
        oldObjectId: input.prepared.plan.targetCommitSha1,
        newObjectId: input.prepared.plan.sourceCommitSha1,
        includeHeadReflog: false,
        beforeBranchReflog: input.preview.targetReflogState,
        message: GIT_REVIEW_REFLOG_MESSAGE,
      })
    : false;
  const final = promoted ? await observePromotion(input) : undefined;
  const verified =
    promoted &&
    updateClean &&
    durable &&
    initial.verified &&
    final?.verified === true;
  const observed = final ?? initial;
  const processes = [
    ...input.prepared.processes,
    ...(input.update ? [input.update] : []),
    ...initial.processes,
    ...(final?.processes ?? []),
  ];
  const details = createGitReviewDetails({
    action: "apply",
    status: verified ? "applied" : "indeterminate",
    postcondition: verified ? "verified" : "indeterminate",
    sourceBranchName: input.preview.sourceBranchName,
    targetBranchName: input.preview.targetBranchName,
    repository: input.repository,
    repositoryState: input.preview.repositoryState,
    plan: input.prepared.plan,
    evidence: gitReviewProcessEvidence(processes),
    ...(observed.afterState
      ? { afterRepositoryStateSha256: observed.afterState.stateSha256 }
      : {}),
    sourcePreviewResultSha256: input.preview.details.resultSha256,
    refUpdateStatus: input.update?.status ?? "unknown",
    ...(input.updateError
      ? { errorSha256: sha256(errorText(input.updateError)) }
      : !updateClean && input.update
        ? { errorSha256: sha256(canonicalJson(input.update)) }
        : {}),
    durable: verified,
    cancellationObserved: input.signal?.aborted === true,
  });
  return {
    sourceBranchName: input.preview.sourceBranchName,
    targetBranchName: input.preview.targetBranchName,
    patch: input.prepared.patch,
    details,
  };
}

async function observePromotion(
  input: Pick<
    Parameters<typeof applyGitReviewPromotion>[0],
    "options" | "repository" | "preview" | "prepared" | "deadline"
  >,
) {
  return settleGitReviewPromotion({
    options: input.options,
    repository: input.repository,
    sourceBranchRef: input.preview.sourceBranchRef,
    targetBranchRef: input.preview.targetBranchRef,
    sourceCommitSha1: input.prepared.plan.sourceCommitSha1,
    repositoryState: input.preview.repositoryState,
    headReflogState: input.preview.headReflogState,
    deadline: input.deadline,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
