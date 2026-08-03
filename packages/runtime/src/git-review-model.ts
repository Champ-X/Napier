import { canonicalJson, sha256 } from "./ed25519.js";
import type { GitBoundFile } from "./git-repository.js";
import type { GitDiffCounts } from "./git-stage-model.js";

export const DEFAULT_GIT_REVIEW_TIMEOUT_MS = 15_000;
export const MAX_GIT_REVIEW_TIMEOUT_MS = 30_000;
export const MAX_GIT_REVIEW_PREVIEWS = 16;
export const GIT_REVIEW_PREVIEW_TTL_MS = 5 * 60_000;
export const MAX_GIT_REVIEW_COMMITS = 64;
export const MAX_GIT_REVIEW_FILES = 32;
export const MAX_GIT_REVIEW_PATCH_BYTES = 128 * 1024;
export const MAX_GIT_REVIEW_TOTAL_BLOB_BYTES = 512 * 1024;
export const GIT_REVIEW_CONTEXT_LINES = 3;
export const GIT_REVIEW_REFLOG_MESSAGE = "napier: promote reviewed commits";

export interface GitReviewPlan {
  sourceBranchRefSha256: string;
  targetBranchRefSha256: string;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  commitCount: number;
  counts: GitDiffCounts;
  rawSha256: string;
  patchSha256: string;
  patchBytes: number;
  headReflogStateSha256: string;
  targetReflogStateSha256: string;
  planSha256: string;
}

export interface GitReviewProcessEvidence {
  sandboxSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  durationMs: number;
}

export interface GitReviewDetails {
  kind: "napier.git-review";
  schemaVersion: 1;
  action: "preview" | "apply";
  status: "ready" | "applied" | "indeterminate";
  postcondition: "not_applied" | "verified" | "indeterminate";
  previewId?: string;
  expiresAt?: string;
  sourceBranchRefSha256: string;
  targetBranchRefSha256: string;
  sourceBranchNameBytes: number;
  targetBranchNameBytes: number;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  commitCount: number;
  fileCount: number;
  hunkCount: number;
  addedLineCount: number;
  deletedLineCount: number;
  patchSha256: string;
  patchBytes: number;
  reviewPlanSha256: string;
  beforeRepositoryStateSha256: string;
  afterRepositoryStateSha256?: string;
  sourcePreviewResultSha256?: string;
  refUpdateStatus?:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "output_capped"
    | "unknown";
  errorSha256?: string;
  runtimeEvidenceSha256: string;
  durationMs: number;
  durable: boolean;
  cancellationObserved: boolean;
  resultSha256: string;
}

export interface GitReviewPreview {
  id: string;
  expiresAt: string;
  sourceBranchName: string;
  targetBranchName: string;
  patch: string;
  details: GitReviewDetails;
}

export interface GitReviewApplyResult {
  sourceBranchName: string;
  targetBranchName: string;
  patch: string;
  details: GitReviewDetails;
}

export function createGitReviewPlan(input: {
  sourceBranchRef: string;
  targetBranchRef: string;
  sourceCommitSha1: string;
  targetCommitSha1: string;
  commitCount: number;
  counts: GitDiffCounts;
  raw: string;
  patch: string;
  headReflog: GitBoundFile;
  targetReflog: GitBoundFile;
}): GitReviewPlan {
  const patchBytes = Buffer.byteLength(input.patch, "utf8");
  if (
    !sha1(input.sourceCommitSha1) ||
    !sha1(input.targetCommitSha1) ||
    input.sourceCommitSha1 === input.targetCommitSha1 ||
    !Number.isSafeInteger(input.commitCount) ||
    input.commitCount < 1 ||
    input.commitCount > MAX_GIT_REVIEW_COMMITS ||
    !countsValid(input.counts) ||
    input.counts.fileCount > MAX_GIT_REVIEW_FILES ||
    patchBytes < 1 ||
    patchBytes > MAX_GIT_REVIEW_PATCH_BYTES
  ) {
    throw new Error("Git review plan is invalid");
  }
  const core = {
    sourceBranchRefSha256: sha256(input.sourceBranchRef),
    targetBranchRefSha256: sha256(input.targetBranchRef),
    sourceCommitSha1: input.sourceCommitSha1,
    targetCommitSha1: input.targetCommitSha1,
    commitCount: input.commitCount,
    counts: input.counts,
    rawSha256: sha256(input.raw),
    patchSha256: sha256(input.patch),
    patchBytes,
    headReflogStateSha256: boundFileSha256(input.headReflog),
    targetReflogStateSha256: boundFileSha256(input.targetReflog),
  };
  return { ...core, planSha256: sha256(canonicalJson(core)) };
}

export function gitReviewDetailsSha256(
  value: Omit<GitReviewDetails, "resultSha256">,
): string {
  return sha256(canonicalJson(value));
}

export function boundFileSha256(file: GitBoundFile): string {
  return sha256(canonicalJson(file));
}

function countsValid(counts: GitDiffCounts): boolean {
  return Object.values(counts).every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
}

function sha1(value: string): boolean {
  return /^[a-f0-9]{40}$/u.test(value);
}
