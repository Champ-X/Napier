import { canonicalJson, sha256 } from "./ed25519.js";
import { gitBranchSwitchArgumentsSha256 } from "./git-inspect-arguments.js";
import type {
  GitBoundFile,
  GitRepository,
  GitRepositoryState,
} from "./git-repository.js";
import {
  gitBranchSwitchDetailsSha256,
  type GitBranchSwitchDetails,
  type GitBranchSwitchProcessEvidence,
} from "./git-branch-switch-model.js";

export function createGitBranchSwitchDetails(input: {
  action: "preview" | "apply";
  status: GitBranchSwitchDetails["status"];
  postcondition: GitBranchSwitchDetails["postcondition"];
  previewId?: string;
  expiresAt?: string;
  targetRef: string;
  targetBranchName: string;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  evidence: GitBranchSwitchProcessEvidence;
  afterRepositoryStateSha256?: string;
  afterHeadReflogState?: GitBoundFile;
  sourcePreviewResultSha256?: string;
  switchStatus?: GitBranchSwitchDetails["switchStatus"];
  errorSha256?: string;
  durable: boolean;
  cancellationObserved: boolean;
}): GitBranchSwitchDetails {
  const core = {
    kind: "napier.git-branch-switch" as const,
    schemaVersion: 1 as const,
    action: input.action,
    status: input.status,
    postcondition: input.postcondition,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    targetRefSha256: sha256(input.targetRef),
    targetBranchNameBytes: Buffer.byteLength(input.targetBranchName, "utf8"),
    commitSha1: input.evidence.commitSha1,
    beforeRepositoryStateSha256: input.repositoryState.stateSha256,
    beforeHeadReflogStateSha256: boundFileStateSha256(input.headReflogState),
    ...(input.afterRepositoryStateSha256
      ? {
          afterRepositoryStateSha256: input.afterRepositoryStateSha256,
        }
      : {}),
    ...(input.afterHeadReflogState
      ? {
          afterHeadReflogStateSha256: boundFileStateSha256(
            input.afterHeadReflogState,
          ),
        }
      : {}),
    ...(input.sourcePreviewResultSha256
      ? { sourcePreviewResultSha256: input.sourcePreviewResultSha256 }
      : {}),
    ...(input.switchStatus ? { switchStatus: input.switchStatus } : {}),
    ...(input.errorSha256 ? { errorSha256: input.errorSha256 } : {}),
    runtimeEvidenceSha256: sha256(
      canonicalJson({
        sandboxSha256: input.evidence.sandboxSha256,
        executableSha256: input.evidence.executableSha256,
        argumentsSha256: gitBranchSwitchArgumentsSha256(input.repository),
        environmentSha256: input.evidence.environmentSha256,
        resourceLimitsSha256: input.evidence.resourceLimitsSha256,
      }),
    ),
    durationMs: input.evidence.durationMs,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
  };
  return { ...core, resultSha256: gitBranchSwitchDetailsSha256(core) };
}

export function boundFileStateSha256(value: GitBoundFile): string {
  return sha256(
    canonicalJson({
      present: value.present,
      sha256: value.sha256,
      bytes: value.bytes,
      mode: value.mode,
    }),
  );
}
