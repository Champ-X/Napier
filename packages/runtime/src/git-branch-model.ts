import { canonicalJson, sha256 } from "./ed25519.js";

export const DEFAULT_GIT_BRANCH_TIMEOUT_MS = 10_000;
export const MAX_GIT_BRANCH_TIMEOUT_MS = 30_000;
export const MAX_GIT_BRANCH_NAME_BYTES = 200;
export const MAX_GIT_BRANCH_PREVIEWS = 16;
export const GIT_BRANCH_PREVIEW_TTL_MS = 5 * 60_000;

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

export interface GitBranchProcessEvidence {
  targetCommitSha1: string;
  sandboxSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  durationMs: number;
}

export interface GitBranchDetails {
  kind: "napier.git-branch";
  schemaVersion: 1;
  operation: "create";
  action: "preview" | "apply";
  status: "ready" | "applied" | "indeterminate";
  postcondition: "not_applied" | "verified" | "indeterminate";
  previewId?: string;
  expiresAt?: string;
  branchRefSha256: string;
  branchNameBytes: number;
  targetCommitSha1: string;
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

export interface GitBranchPreview {
  id: string;
  expiresAt: string;
  branchName: string;
  details: GitBranchDetails;
}

export interface GitBranchApplyResult {
  branchName: string;
  details: GitBranchDetails;
}

export function normalizeGitBranchName(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > MAX_GIT_BRANCH_NAME_BYTES ||
    !BRANCH_NAME_PATTERN.test(value) ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("//")
  ) {
    throw new Error("Git branch name is invalid");
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.endsWith(".") ||
        segment.toLowerCase().endsWith(".lock"),
    )
  ) {
    throw new Error("Git branch name is invalid");
  }
  return value;
}

export function gitBranchDetailsSha256(
  value: Omit<GitBranchDetails, "resultSha256">,
): string {
  return sha256(canonicalJson(value));
}
