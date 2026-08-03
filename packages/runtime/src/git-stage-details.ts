import { canonicalJson, sha256 } from "./ed25519.js";
import { gitStageOperationArgumentsSha256 } from "./git-stage-hunk-arguments.js";
import type { GitRepository, GitRepositoryState } from "./git-repository.js";
import type { PreparedGitStage } from "./git-stage-private-index.js";
import type { GitStageDetails } from "./git-stage-model.js";
import {
  gitStageTargetAttributesSha256,
  gitStageTargetPathsSha256,
  gitStageTargetStatesSha256,
  type GitStageTarget,
} from "./git-stage-targets.js";

export function createGitStageDetails(input: {
  action: "preview" | "apply";
  status: GitStageDetails["status"];
  postcondition: GitStageDetails["postcondition"];
  previewId?: string;
  expiresAt?: string;
  repository: GitRepository;
  repositoryState: GitRepositoryState;
  targets: readonly GitStageTarget[];
  contextLines: number;
  prepared: PreparedGitStage;
  afterIndexSha256?: string;
  sourcePreviewResultSha256?: string;
  durable: boolean;
  cancellationObserved: boolean;
}): GitStageDetails {
  const core = {
    kind: "napier.git-stage" as const,
    schemaVersion: 1 as const,
    action: input.action,
    status: input.status,
    postcondition: input.postcondition,
    ...(input.previewId ? { previewId: input.previewId } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    pathSha256: gitStageTargetPathsSha256(input.targets),
    pathStateSha256: gitStageTargetStatesSha256(input.targets),
    attributesStateSha256: gitStageTargetAttributesSha256(input.targets),
    contextLines: input.contextLines,
    ...input.prepared.counts,
    patchSha256: sha256(input.prepared.patch),
    patchBytes: Buffer.byteLength(input.prepared.patch, "utf8"),
    beforeRepositoryStateSha256: input.repositoryState.stateSha256,
    beforeNonIndexStateSha256: input.repositoryState.nonIndexStateSha256,
    beforeIndexSha256: input.repositoryState.index.sha256,
    proposedIndexSha256: input.prepared.indexSha256,
    ...(input.afterIndexSha256
      ? { afterIndexSha256: input.afterIndexSha256 }
      : {}),
    ...(input.sourcePreviewResultSha256
      ? { sourcePreviewResultSha256: input.sourcePreviewResultSha256 }
      : {}),
    sandboxSha256: input.prepared.sandboxSha256,
    gitExecutableSha256: input.prepared.executableSha256,
    gitArgumentsSha256: gitStageOperationArgumentsSha256(
      input.repository,
      input.targets.map((target) => target.path),
      input.contextLines,
      input.prepared.selectionMode,
      input.prepared.hunkSelectionSha256,
    ),
    gitEnvironmentSha256: input.prepared.environmentSha256,
    gitResourceLimitsSha256: input.prepared.resourceLimitsSha256,
    durationMs: input.prepared.durationMs,
    durable: input.durable,
    cancellationObserved: input.cancellationObserved,
  };
  return { ...core, resultSha256: sha256(canonicalJson(core)) };
}
