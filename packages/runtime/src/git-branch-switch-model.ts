import { canonicalJson, sha256 } from "./ed25519.js";

export interface GitBranchSwitchProcessEvidence {
  commitSha1: string;
  sandboxSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  durationMs: number;
}

export interface GitBranchSwitchDetails {
  kind: "napier.git-branch-switch";
  schemaVersion: 1;
  action: "preview" | "apply";
  status: "ready" | "applied" | "indeterminate";
  postcondition: "not_applied" | "verified" | "indeterminate";
  previewId?: string;
  expiresAt?: string;
  targetRefSha256: string;
  targetBranchNameBytes: number;
  commitSha1: string;
  beforeRepositoryStateSha256: string;
  beforeHeadReflogStateSha256: string;
  afterRepositoryStateSha256?: string;
  afterHeadReflogStateSha256?: string;
  sourcePreviewResultSha256?: string;
  switchStatus?:
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

export interface GitBranchSwitchPreview {
  id: string;
  expiresAt: string;
  targetBranchName: string;
  details: GitBranchSwitchDetails;
}

export interface GitBranchSwitchApplyResult {
  targetBranchName: string;
  details: GitBranchSwitchDetails;
}

export function gitBranchSwitchDetailsSha256(
  value: Omit<GitBranchSwitchDetails, "resultSha256">,
): string {
  return sha256(canonicalJson(value));
}
