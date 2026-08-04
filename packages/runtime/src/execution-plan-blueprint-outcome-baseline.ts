import type {
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
  ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ModelRef,
} from "@napier/contracts";

import {
  normalizeExecutionPlanBlueprintOutcomeBaselinePolicy,
  normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate,
} from "./execution-plan-blueprint-outcome-policy.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export interface ExecutionPlanBlueprintOutcomeBaselineReviewEvidence {
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate;
  reviewSha256: string;
  reviewInputSha256: string;
  reviewResponseSha256: string;
  reviewVerdict: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewVerdict"]
  >;
  reviewScore: number;
  reviewRisk: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]
  >;
  reviewModel: NonNullable<
    ExecutionPlanBlueprintRecordOutcomeBaseline["reviewModel"]
  >;
}

export function createExecutionPlanBlueprintOutcomeBaseline(input: {
  id: string;
  recordId: string;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy;
  reviewEvidence?: ExecutionPlanBlueprintOutcomeBaselineReviewEvidence;
  promotedAt: string;
  supersedesBaselineId?: string;
}): ExecutionPlanBlueprintRecordOutcomeBaseline {
  const content = {
    id: input.id,
    recordId: input.recordId,
    replayOutcomesSha256: input.outcomes.contentSha256,
    replayHistorySha256: input.outcomes.replayHistorySha256,
    outcomeSetSha256: input.outcomes.outcomeSetSha256,
    replayCount: input.outcomes.replayCount,
    completedCount: input.outcomes.completedCount,
    blockedCount: input.outcomes.blockedCount,
    invalidCount: input.outcomes.invalidCount,
    completionRateBps: input.outcomes.completionRateBps,
    policy: input.policy,
    ...(input.reviewEvidence
      ? {
          reviewGate: input.reviewEvidence.reviewGate,
          reviewSha256: input.reviewEvidence.reviewSha256,
          reviewInputSha256: input.reviewEvidence.reviewInputSha256,
          reviewResponseSha256: input.reviewEvidence.reviewResponseSha256,
          reviewVerdict: input.reviewEvidence.reviewVerdict,
          reviewScore: input.reviewEvidence.reviewScore,
          reviewRisk: input.reviewEvidence.reviewRisk,
          reviewModel: input.reviewEvidence.reviewModel,
        }
      : {}),
    promotedAt: input.promotedAt,
    ...(input.supersedesBaselineId
      ? { supersedesBaselineId: input.supersedesBaselineId }
      : {}),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateExecutionPlanBlueprintOutcomeBaseline(
  value: unknown,
): ExecutionPlanBlueprintRecordOutcomeBaseline {
  if (!isRecord(value)) {
    throw invalidBaseline();
  }
  const baseline =
    value as unknown as ExecutionPlanBlueprintRecordOutcomeBaseline;
  const policy = normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
    baseline.policy,
  );
  const reviewGate =
    baseline.reviewGate === undefined
      ? undefined
      : normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
          baseline.reviewGate,
        );
  if (
    !validBaselineCore(baseline) ||
    !validBaselineReviewEvidence(baseline, reviewGate)
  ) {
    throw invalidBaseline();
  }
  const normalized = {
    ...baseline,
    policy,
    ...(reviewGate ? { reviewGate } : {}),
  };
  const { contentSha256: _contentSha256, ...content } = normalized;
  if (sha256(canonicalJson(content)) !== baseline.contentSha256) {
    throw new Error("Execution Plan blueprint outcome baseline hash mismatch");
  }
  return structuredClone(normalized);
}

function validBaselineCore(
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
): boolean {
  return (
    typeof baseline.id === "string" &&
    typeof baseline.recordId === "string" &&
    isSha256(baseline.replayOutcomesSha256) &&
    isSha256(baseline.replayHistorySha256) &&
    isSha256(baseline.outcomeSetSha256) &&
    nonNegativeInteger(baseline.replayCount) &&
    nonNegativeInteger(baseline.completedCount) &&
    nonNegativeInteger(baseline.blockedCount) &&
    nonNegativeInteger(baseline.invalidCount) &&
    nonNegativeInteger(baseline.completionRateBps) &&
    baseline.completionRateBps <= 10_000 &&
    Number.isFinite(Date.parse(baseline.promotedAt)) &&
    (baseline.supersedesBaselineId === undefined ||
      typeof baseline.supersedesBaselineId === "string") &&
    isSha256(baseline.contentSha256)
  );
}

function validBaselineReviewEvidence(
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate | undefined,
): boolean {
  if (!hasReviewEvidence(baseline)) return true;
  return Boolean(
    reviewGate &&
    isSha256(baseline.reviewSha256) &&
    isSha256(baseline.reviewInputSha256) &&
    isSha256(baseline.reviewResponseSha256) &&
    baseline.reviewVerdict === "promote" &&
    nonNegativeInteger(baseline.reviewScore) &&
    baseline.reviewScore <= 100 &&
    validRisk(baseline.reviewRisk) &&
    isModelRef(baseline.reviewModel),
  );
}

function hasReviewEvidence(
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
): boolean {
  return (
    baseline.reviewSha256 !== undefined ||
    baseline.reviewInputSha256 !== undefined ||
    baseline.reviewResponseSha256 !== undefined ||
    baseline.reviewVerdict !== undefined ||
    baseline.reviewScore !== undefined ||
    baseline.reviewRisk !== undefined ||
    baseline.reviewModel !== undefined ||
    baseline.reviewGate !== undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validRisk(
  value: unknown,
): value is ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"] {
  return value === "low" || value === "medium" || value === "high";
}

function isModelRef(value: unknown): value is ModelRef {
  if (!isRecord(value)) return false;
  return (
    typeof value["provider"] === "string" &&
    /^[a-z0-9][a-z0-9._-]{1,80}$/u.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value["id"])
  );
}

function invalidBaseline(): Error {
  return new Error("Execution Plan blueprint outcome baseline is invalid");
}
