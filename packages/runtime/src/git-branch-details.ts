import { canonicalJson, sha256 } from "./ed25519.js";
import { gitBranchArgumentsSha256 } from "./git-inspect-arguments.js";
import type { GitRepository, GitRepositoryState } from "./git-repository.js";
import {
  gitBranchDetailsSha256,
  type GitBranchDetails,
  type GitBranchProcessEvidence,
} from "./git-branch-model.js";

export function createGitBranchDetails(input: {
  action: "preview" | "apply";
  status: GitBranchDetails["status"];
  postcondition: GitBranchDetails["postcondition"];
  previewId?: string;
  expiresAt?: string;
  branchName: string;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  evidence: GitBranchProcessEvidence;
  afterRepositoryStateSha256?: string;
  sourcePreviewResultSha256?: string;
  refUpdateStatus?: GitBranchDetails["refUpdateStatus"];
  errorSha256?: string;
  durable: boolean;
  cancellationObserved: boolean;
}): GitBranchDetails {
  const branchRef = `refs/heads/${input.branchName}`;
  const core = {
    kind: "napier.git-branch" as const,
    schemaVersion: 1 as const,
    operation: "create" as const,
    action: input.action,
    status: input.status,
    postcondition: input.postcondition,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    branchRefSha256: sha256(branchRef),
    branchNameBytes: Buffer.byteLength(input.branchName, "utf8"),
    targetCommitSha1: input.evidence.targetCommitSha1,
    beforeRepositoryStateSha256: input.repositoryState.stateSha256,
    ...(input.afterRepositoryStateSha256
      ? {
          afterRepositoryStateSha256: input.afterRepositoryStateSha256,
        }
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
        argumentsSha256: gitBranchArgumentsSha256(input.repository),
        environmentSha256: input.evidence.environmentSha256,
        resourceLimitsSha256: input.evidence.resourceLimitsSha256,
      }),
    ),
    durationMs: input.evidence.durationMs,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
  };
  return { ...core, resultSha256: gitBranchDetailsSha256(core) };
}
