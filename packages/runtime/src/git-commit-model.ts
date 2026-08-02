import { canonicalJson, sha256 } from "./ed25519.js";
import type { GitDiffCounts } from "./git-stage-model.js";

export const DEFAULT_GIT_COMMIT_TIMEOUT_MS = 15_000;
export const MAX_GIT_COMMIT_TIMEOUT_MS = 30_000;
export const MAX_GIT_COMMIT_MESSAGE_BYTES = 4 * 1024;
export const MAX_GIT_COMMIT_FILES = 32;
export const MAX_GIT_COMMIT_PREVIEWS = 16;
export const GIT_COMMIT_PREVIEW_TTL_MS = 5 * 60_000;

export interface GitCommitDetails extends GitDiffCounts {
  kind: "napier.git-commit";
  schemaVersion: 1;
  action: "preview" | "apply";
  status: "ready" | "applied" | "indeterminate";
  postcondition: "not_applied" | "verified" | "indeterminate";
  previewId?: string;
  expiresAt?: string;
  messageSha256: string;
  messageBytes: number;
  branchRefSha256: string;
  parentCommitSha1: string;
  treeSha1: string;
  proposedCommitSha1: string;
  commitTimestampSeconds: number;
  identitySha256: string;
  contextLines: number;
  stagedPatchSha256: string;
  stagedPatchBytes: number;
  beforeRepositoryStateSha256: string;
  afterHeadStateSha256?: string;
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

export interface GitCommitPreview {
  id: string;
  expiresAt: string;
  branchRef: string;
  message: string;
  stagedPatch: string;
  details: GitCommitDetails;
}

export interface GitCommitApplyResult {
  branchRef: string;
  message: string;
  stagedPatch: string;
  details: GitCommitDetails;
}

export function normalizeGitCommitMessage(value: string): string {
  if (
    typeof value !== "string" ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Git commit message is invalid");
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  const bytes = Buffer.byteLength(normalized, "utf8");
  const subject = normalized.split("\n", 1)[0] ?? "";
  if (
    bytes < 1 ||
    bytes > MAX_GIT_COMMIT_MESSAGE_BYTES ||
    subject.length < 1 ||
    Buffer.byteLength(subject, "utf8") > 200
  ) {
    throw new Error("Git commit message exceeds its bounded limit");
  }
  return `${normalized}\n`;
}

export function gitCommitMessageEvidence(message: string): {
  messageSha256: string;
  messageBytes: number;
} {
  return {
    messageSha256: sha256(message),
    messageBytes: Buffer.byteLength(message, "utf8"),
  };
}

export function gitCommitDetailsSha256(
  value: Omit<GitCommitDetails, "resultSha256">,
): string {
  return sha256(canonicalJson(value));
}
