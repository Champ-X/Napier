import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  progressHash,
  progressInteger,
  progressRecord,
} from "./run-progress-evidence-projection.js";

export {
  assistantEvidence,
  isAcquisitionFailure,
  isApprovalResolution,
  isCapabilityEvent,
  progressElapsedMs,
  progressHash,
  progressInteger,
  progressRecord,
  progressText,
  stableEventEvidence,
  stableStateHash,
  stableToolProgress,
  type StableToolProgress,
} from "./run-progress-evidence-projection.js";

export type RunProgressDimension =
  | "workspace"
  | "plan"
  | "artifact"
  | "source"
  | "approval"
  | "capability"
  | "result";

export interface RunProgressDimensionHashes {
  workspace: string;
  plan: string;
  artifact: string;
  source: string;
  approval: string;
  capability: string;
  result: string;
}

export interface RunProgressPlanProjection {
  revisionTotal: number;
  planStatusCounts: Record<string, number>;
  stepStatusCounts: Record<string, number>;
  productScore: number;
  acceptanceScore: number;
  sha256: string;
}

export interface RunProgressArtifactProjection {
  artifactCount: number;
  candidateCount: number;
  statusCounts: Record<string, number>;
  productScore: number;
  acceptanceScore: number;
  sha256: string;
}

export interface RunProgressTransition {
  progressed: boolean;
  productProgressed: boolean;
  acceptanceProgressed: boolean;
  supportProgressed: boolean;
  regressed: boolean;
  changedDimensions: RunProgressDimension[];
}

export interface PreviousProgressScores {
  planProduct: number;
  planAcceptance: number;
  artifactProduct: number;
  artifactAcceptance: number;
}

interface RunProgressVectorContentInput {
  projectionId: string;
  turnIndex: number;
  turnCompletedSeq: number;
  elapsedMs: number;
  transition: RunProgressTransition;
  stagnantTurnCount: number;
  stagnantElapsedMs: number;
  acquisitionOnlyTurnCount: number;
  acquisitionStagnantTurnCount: number;
  workspaceMutationCount: number;
  supportResourceCount: number;
  productReceiptCount: number;
  supportCount: number;
  acquisitionAttemptCount: number;
  acquisitionAttemptCountSinceProgress: number;
  acquisitionAdvanceCountSinceProgress: number;
  failureDomainCountSinceProgress: number;
  unclassifiedActivityCountSinceProgress: number;
  acceptanceReceiptCount: number;
  deliveryReadiness:
    | "no_product"
    | "unverified"
    | "stale"
    | "verification_failed"
    | "ready";
  deliveryReadinessBlockerCount: number;
  productEffectCount: number;
  marginalProductAdvancedCount: number;
  marginalProductRegressedCount: number;
  indeterminateProductEffectCount: number;
  invalidMarginalEvidenceCount: number;
  unboundVerificationCount: number;
  deliveryAttemptCount: number;
  explicitAcceptanceCount: number;
  approvalCount: number;
  capabilityStatusCount: number;
  userResultCount: number;
  planCount: number;
  planState: RunProgressPlanProjection;
  artifactState: RunProgressArtifactProjection;
  failureFingerprints: Set<string>;
  failureDomains: Set<string>;
  dimensions: RunProgressDimensionHashes;
  predecessorContentSha256: string;
  firstWorkspaceMutationTurn?: number;
  firstWorkspaceMutationElapsedMs?: number;
}

export interface RunProgressHydrationProjection {
  turnIndex: number;
  stagnantTurnCount: number;
  acquisitionOnlyTurnCount: number;
  acquisitionStagnantTurnCount: number;
  acquisitionAttemptCount?: number;
  acquisitionAttemptCountSinceProgress?: number;
  acquisitionAdvanceCountSinceProgress?: number;
  failureDomainCountSinceProgress?: number;
  unclassifiedActivityCountSinceProgress?: number;
  previousContentSha256: string;
  lastProgressElapsedMs: number;
  firstWorkspaceMutationTurn?: number;
  firstWorkspaceMutationElapsedMs?: number;
  previousScores?: PreviousProgressScores;
  previousDimensions?: RunProgressDimensionHashes;
}

const EMPTY_SET_SHA256 = sha256(canonicalJson([]));

export function hashProgressMap(values: Map<string, string>): string {
  return values.size === 0
    ? EMPTY_SET_SHA256
    : sha256(
        canonicalJson(
          [...values.entries()].sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
}

export function hashProgressSet(values: Set<string>): string {
  return values.size === 0
    ? EMPTY_SET_SHA256
    : sha256(canonicalJson([...values].sort()));
}

export function emptyProgressDimensions(): RunProgressDimensionHashes {
  return {
    workspace: EMPTY_SET_SHA256,
    plan: EMPTY_SET_SHA256,
    artifact: EMPTY_SET_SHA256,
    source: EMPTY_SET_SHA256,
    approval: EMPTY_SET_SHA256,
    capability: EMPTY_SET_SHA256,
    result: EMPTY_SET_SHA256,
  };
}

export function projectRunProgressTransition(input: {
  productAdvanced: boolean;
  productRegressed: boolean;
  acceptanceAdvanced: boolean;
  supportAdvanced: boolean;
  planState: RunProgressPlanProjection;
  artifactState: RunProgressArtifactProjection;
  previousScores: PreviousProgressScores;
  dimensions: RunProgressDimensionHashes;
  previousDimensions: RunProgressDimensionHashes;
}): RunProgressTransition {
  const productProgressed =
    input.productAdvanced ||
    input.planState.productScore > input.previousScores.planProduct ||
    input.artifactState.productScore > input.previousScores.artifactProduct;
  const acceptanceProgressed =
    input.acceptanceAdvanced ||
    input.planState.acceptanceScore > input.previousScores.planAcceptance ||
    input.artifactState.acceptanceScore >
      input.previousScores.artifactAcceptance;
  return {
    progressed: productProgressed || acceptanceProgressed,
    productProgressed,
    acceptanceProgressed,
    supportProgressed: input.supportAdvanced,
    regressed:
      input.productRegressed ||
      input.planState.productScore < input.previousScores.planProduct ||
      input.planState.acceptanceScore < input.previousScores.planAcceptance ||
      input.artifactState.productScore < input.previousScores.artifactProduct ||
      input.artifactState.acceptanceScore <
        input.previousScores.artifactAcceptance,
    changedDimensions: progressDimensionNames().filter(
      (dimension) =>
        input.dimensions[dimension] !== input.previousDimensions[dimension],
    ),
  };
}

export function projectRunProgressVectorContent(
  input: RunProgressVectorContentInput,
) {
  const content = {
    kind: "napier.run-progress-vector" as const,
    schemaVersion: 2 as const,
    projectionId: input.projectionId,
    turnIndex: input.turnIndex,
    turnCompletedSeq: input.turnCompletedSeq,
    elapsedMs: input.elapsedMs,
    ...input.transition,
    stagnantTurnCount: input.stagnantTurnCount,
    stagnantElapsedMs: input.stagnantElapsedMs,
    acquisitionOnlyTurnCount: input.acquisitionOnlyTurnCount,
    acquisitionStagnantTurnCount: input.acquisitionStagnantTurnCount,
    workspaceMutationCount: input.workspaceMutationCount,
    sourceCount: input.supportResourceCount,
    productCount:
      input.productReceiptCount +
      input.planState.productScore +
      input.artifactState.productScore,
    supportCount: input.supportCount,
    supportResourceCount: input.supportResourceCount,
    acquisitionAttemptCount: input.acquisitionAttemptCount,
    acquisitionAttemptCountSinceProgress:
      input.acquisitionAttemptCountSinceProgress,
    acquisitionAdvanceCountSinceProgress:
      input.acquisitionAdvanceCountSinceProgress,
    failureDomainCountSinceProgress: input.failureDomainCountSinceProgress,
    unclassifiedActivityCountSinceProgress:
      input.unclassifiedActivityCountSinceProgress,
    deliveryReadiness: input.deliveryReadiness,
    deliveryReadinessBlockerCount: input.deliveryReadinessBlockerCount,
    productEffectCount: input.productEffectCount,
    marginalProductAdvancedCount: input.marginalProductAdvancedCount,
    marginalProductRegressedCount: input.marginalProductRegressedCount,
    indeterminateProductEffectCount: input.indeterminateProductEffectCount,
    invalidMarginalEvidenceCount: input.invalidMarginalEvidenceCount,
    unboundVerificationCount: input.unboundVerificationCount,
    deliveryAttemptCount: input.deliveryAttemptCount,
    explicitAcceptanceCount: input.explicitAcceptanceCount,
    acceptanceCount:
      input.acceptanceReceiptCount +
      input.explicitAcceptanceCount +
      input.planState.acceptanceScore +
      input.artifactState.acceptanceScore,
    controlCount: input.approvalCount + input.capabilityStatusCount,
    approvalCount: input.approvalCount,
    capabilityStatusCount: input.capabilityStatusCount,
    userResultCount: input.userResultCount,
    planCount: input.planCount,
    planRevisionTotal: input.planState.revisionTotal,
    planStatusCounts: input.planState.planStatusCounts,
    stepStatusCounts: input.planState.stepStatusCounts,
    artifactCount: input.artifactState.artifactCount,
    artifactCandidateCount: input.artifactState.candidateCount,
    artifactStatusCounts: input.artifactState.statusCounts,
    failureFingerprintCount: input.failureFingerprints.size,
    failureFingerprintSetSha256: hashProgressSet(input.failureFingerprints),
    failureDomainCount: input.failureDomains.size,
    failureDomainSetSha256: hashProgressSet(input.failureDomains),
    progressScores: {
      planProduct: input.planState.productScore,
      planAcceptance: input.planState.acceptanceScore,
      artifactProduct: input.artifactState.productScore,
      artifactAcceptance: input.artifactState.acceptanceScore,
    },
    dimensions: input.dimensions,
    predecessorContentSha256: input.predecessorContentSha256,
    ...(input.firstWorkspaceMutationTurn !== undefined
      ? {
          firstWorkspaceMutationTurn: input.firstWorkspaceMutationTurn,
          firstWorkspaceMutationElapsedMs:
            input.firstWorkspaceMutationElapsedMs!,
        }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function projectRunProgressHydration(
  payload: Record<string, JsonValue> | undefined,
): RunProgressHydrationProjection {
  const elapsedMs = progressInteger(payload?.["elapsedMs"]) ?? 0;
  const stagnantElapsedMs =
    progressInteger(payload?.["stagnantElapsedMs"]) ?? 0;
  const acquisitionAttemptCount = progressInteger(
    payload?.["acquisitionAttemptCount"],
  );
  const acquisitionAttemptCountSinceProgress = progressInteger(
    payload?.["acquisitionAttemptCountSinceProgress"],
  );
  const acquisitionAdvanceCountSinceProgress = progressInteger(
    payload?.["acquisitionAdvanceCountSinceProgress"],
  );
  const failureDomainCountSinceProgress = progressInteger(
    payload?.["failureDomainCountSinceProgress"],
  );
  const unclassifiedActivityCountSinceProgress = progressInteger(
    payload?.["unclassifiedActivityCountSinceProgress"],
  );
  const firstWorkspaceMutationTurn = progressInteger(
    payload?.["firstWorkspaceMutationTurn"],
  );
  const firstWorkspaceMutationElapsedMs = progressInteger(
    payload?.["firstWorkspaceMutationElapsedMs"],
  );
  const previousScores = progressScores(payload?.["progressScores"]);
  const previousDimensions = progressDimensions(payload?.["dimensions"]);
  return {
    turnIndex: progressInteger(payload?.["turnIndex"]) ?? 0,
    stagnantTurnCount: progressInteger(payload?.["stagnantTurnCount"]) ?? 0,
    acquisitionOnlyTurnCount:
      progressInteger(payload?.["acquisitionOnlyTurnCount"]) ?? 0,
    acquisitionStagnantTurnCount:
      progressInteger(payload?.["acquisitionStagnantTurnCount"]) ?? 0,
    ...(acquisitionAttemptCount !== undefined
      ? { acquisitionAttemptCount }
      : {}),
    ...(acquisitionAttemptCountSinceProgress !== undefined
      ? { acquisitionAttemptCountSinceProgress }
      : {}),
    ...(acquisitionAdvanceCountSinceProgress !== undefined
      ? { acquisitionAdvanceCountSinceProgress }
      : {}),
    ...(failureDomainCountSinceProgress !== undefined
      ? { failureDomainCountSinceProgress }
      : {}),
    ...(unclassifiedActivityCountSinceProgress !== undefined
      ? { unclassifiedActivityCountSinceProgress }
      : {}),
    previousContentSha256: progressHash(payload?.["contentSha256"]) ?? "",
    lastProgressElapsedMs: Math.max(0, elapsedMs - stagnantElapsedMs),
    ...(firstWorkspaceMutationTurn !== undefined
      ? { firstWorkspaceMutationTurn }
      : {}),
    ...(firstWorkspaceMutationElapsedMs !== undefined
      ? { firstWorkspaceMutationElapsedMs }
      : {}),
    ...(previousScores ? { previousScores } : {}),
    ...(previousDimensions ? { previousDimensions } : {}),
  };
}

function progressScores(
  value: JsonValue | undefined,
): PreviousProgressScores | undefined {
  const candidate = progressRecord(value);
  const planProduct = progressInteger(candidate?.["planProduct"]);
  const planAcceptance = progressInteger(candidate?.["planAcceptance"]);
  const artifactProduct = progressInteger(candidate?.["artifactProduct"]);
  const artifactAcceptance = progressInteger(candidate?.["artifactAcceptance"]);
  return planProduct !== undefined &&
    planAcceptance !== undefined &&
    artifactProduct !== undefined &&
    artifactAcceptance !== undefined
    ? { planProduct, planAcceptance, artifactProduct, artifactAcceptance }
    : undefined;
}

function progressDimensions(
  value: JsonValue | undefined,
): RunProgressDimensionHashes | undefined {
  const candidate = progressRecord(value);
  const entries = progressDimensionNames().map(
    (dimension) => [dimension, progressHash(candidate?.[dimension])] as const,
  );
  return entries.every(([, hash]) => hash !== undefined)
    ? (Object.fromEntries(entries) as unknown as RunProgressDimensionHashes)
    : undefined;
}

export function progressDimensionNames(): RunProgressDimension[] {
  return [
    "workspace",
    "plan",
    "artifact",
    "source",
    "approval",
    "capability",
    "result",
  ];
}

export function addProgressEvidence(
  values: Set<string>,
  value: string,
): boolean {
  const size = values.size;
  values.add(value);
  return values.size > size;
}
