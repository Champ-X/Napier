import type {
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ModelRef,
} from "@napier/contracts";

import type { ExecutionPlanBlueprintOutcomeBaselineReviewEvidence } from "./execution-plan-blueprint-outcome-baseline.js";
import { validateModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintOutcomeBaselineReviewEvidence(input: {
  recordId: string;
  review: unknown;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate;
}): ExecutionPlanBlueprintOutcomeBaselineReviewEvidence {
  const review = validateExecutionPlanBlueprintOutcomeReview(input.review);
  const diagnostics: string[] = [];
  pushReviewIdentityDiagnostics(diagnostics, review, input);
  pushReviewOutcomeDiagnostics(diagnostics, review, input.outcomes);
  pushReviewQualificationDiagnostics(diagnostics, review, input);
  pushReviewGateDiagnostics(diagnostics, review, input.reviewGate);
  if (diagnostics.length > 0) {
    throw new Error(
      `Execution plan blueprint outcome baseline review failed: ${diagnostics.join(",")}`,
    );
  }
  return {
    reviewGate: input.reviewGate,
    reviewSha256: review.reviewSha256,
    reviewInputSha256: review.inputSha256,
    reviewResponseSha256: review.responseSha256,
    reviewVerdict: review.verdict,
    reviewScore: review.score,
    reviewRisk: review.risk,
    reviewModel: review.model,
  };
}

export function validateExecutionPlanBlueprintOutcomeReview(
  value: unknown,
): ExecutionPlanBlueprintRecordOutcomeReview {
  if (!isRecord(value)) throw invalidReview();
  const review = value as unknown as ExecutionPlanBlueprintRecordOutcomeReview;
  if (
    !validReviewIdentity(review) ||
    !validReviewDecision(review) ||
    !validReviewOutcomeEvidence(review) ||
    !validReviewHashEvidence(review)
  ) {
    throw invalidReview();
  }
  if (review.modelContextEnvelope !== undefined) {
    validateModelContextEnvelopeReceipt(review.modelContextEnvelope);
  }
  const { reviewSha256: _reviewSha256, ...content } = review;
  if (sha256(canonicalJson(content)) !== review.reviewSha256) {
    throw new Error("Execution plan blueprint outcome review hash mismatch");
  }
  return structuredClone(review);
}

function pushReviewIdentityDiagnostics(
  diagnostics: string[],
  review: ExecutionPlanBlueprintRecordOutcomeReview,
  input: {
    recordId: string;
    sourceQualification: ExecutionPlanBlueprintRecordQualification;
  },
): void {
  pushDiagnostic(
    diagnostics,
    review.recordId !== input.recordId,
    "record_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    review.blueprintSha256 !== input.sourceQualification.blueprintSha256,
    "blueprint_mismatch",
  );
}

function pushReviewOutcomeDiagnostics(
  diagnostics: string[],
  review: ExecutionPlanBlueprintRecordOutcomeReview,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
): void {
  const checks: Array<[boolean, string]> = [
    [
      review.replayOutcomesSha256 !== outcomes.contentSha256,
      "outcomes_mismatch",
    ],
    [
      review.replayHistorySha256 !== outcomes.replayHistorySha256,
      "replay_history_mismatch",
    ],
    [
      review.outcomeSetSha256 !== outcomes.outcomeSetSha256,
      "outcome_set_mismatch",
    ],
    [review.replayCount !== outcomes.replayCount, "replay_count_mismatch"],
    [
      review.completedCount !== outcomes.completedCount,
      "completed_count_mismatch",
    ],
    [review.blockedCount !== outcomes.blockedCount, "blocked_count_mismatch"],
    [review.invalidCount !== outcomes.invalidCount, "invalid_count_mismatch"],
    [
      review.completionRateBps !== outcomes.completionRateBps,
      "completion_rate_mismatch",
    ],
  ];
  for (const [condition, diagnostic] of checks) {
    pushDiagnostic(diagnostics, condition, diagnostic);
  }
}

function pushReviewQualificationDiagnostics(
  diagnostics: string[],
  review: ExecutionPlanBlueprintRecordOutcomeReview,
  input: {
    sourceQualification: ExecutionPlanBlueprintRecordQualification;
    outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  },
): void {
  pushDiagnostic(
    diagnostics,
    review.sourceQualificationStatus !== input.sourceQualification.status ||
      input.sourceQualification.status !== "qualified",
    "source_qualification_mismatch",
  );
  pushDiagnostic(
    diagnostics,
    review.outcomeQualificationStatus !== input.outcomeQualification.status,
    "outcome_qualification_mismatch",
  );
}

function pushReviewGateDiagnostics(
  diagnostics: string[],
  review: ExecutionPlanBlueprintRecordOutcomeReview,
  reviewGate: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate,
): void {
  pushDiagnostic(
    diagnostics,
    review.verdict !== "promote",
    "review_not_promote",
  );
  pushDiagnostic(
    diagnostics,
    review.score < reviewGate.minScore,
    "review_score_below_min",
  );
  pushDiagnostic(
    diagnostics,
    outcomeReviewRiskRank(review.risk) >
      outcomeReviewRiskRank(reviewGate.maxRisk),
    "review_risk_above_max",
  );
}

function validReviewIdentity(
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): boolean {
  return (
    review.kind === "napier.execution-plan-blueprint-outcome-review" &&
    review.schemaVersion === 1 &&
    typeof review.policyId === "string" &&
    typeof review.recordId === "string" &&
    isSha256(review.blueprintSha256) &&
    isModelRef(review.model) &&
    isRecord(review.criteria)
  );
}

function validReviewDecision(
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): boolean {
  return (
    validVerdict(review.verdict) &&
    nonNegativeInteger(review.score) &&
    review.score <= 100 &&
    validRisk(review.risk) &&
    typeof review.reason === "string" &&
    Array.isArray(review.concerns) &&
    Array.isArray(review.scores) &&
    validSourceQualificationStatus(review.sourceQualificationStatus) &&
    validOutcomeQualificationStatus(review.outcomeQualificationStatus)
  );
}

function validReviewOutcomeEvidence(
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): boolean {
  return (
    isSha256(review.replayOutcomesSha256) &&
    isSha256(review.replayHistorySha256) &&
    isSha256(review.outcomeSetSha256) &&
    nonNegativeInteger(review.replayCount) &&
    nonNegativeInteger(review.completedCount) &&
    nonNegativeInteger(review.blockedCount) &&
    nonNegativeInteger(review.invalidCount) &&
    nonNegativeInteger(review.completionRateBps) &&
    review.completionRateBps <= 10_000 &&
    (review.baselineId === undefined ||
      typeof review.baselineId === "string") &&
    (review.baselineSha256 === undefined || isSha256(review.baselineSha256)) &&
    (review.baselineOutcomesSha256 === undefined ||
      isSha256(review.baselineOutcomesSha256))
  );
}

function validReviewHashEvidence(
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): boolean {
  return (
    isSha256(review.inputSha256) &&
    isSha256(review.promptSha256) &&
    isSha256(review.responseSha256) &&
    isSha256(review.reviewSchemaSha256) &&
    isSha256(review.reviewSha256) &&
    Number.isFinite(Date.parse(review.createdAt))
  );
}

function outcomeReviewRiskRank(
  risk: NonNullable<ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]>,
): number {
  return risk === "low" ? 0 : risk === "medium" ? 1 : 2;
}

function validVerdict(
  value: unknown,
): value is ExecutionPlanBlueprintRecordOutcomeReview["verdict"] {
  return (
    value === "promote" ||
    value === "revise" ||
    value === "reject" ||
    value === "inconclusive"
  );
}

function validRisk(
  value: unknown,
): value is NonNullable<
  ExecutionPlanBlueprintRecordOutcomeBaseline["reviewRisk"]
> {
  return value === "low" || value === "medium" || value === "high";
}

function validSourceQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification["status"] {
  return (
    value === "qualified" ||
    value === "archived" ||
    value === "source_missing" ||
    value === "source_drift" ||
    value === "invalid"
  );
}

function validOutcomeQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordOutcomeQualification["status"] {
  return (
    value === "qualified" ||
    value === "missing_baseline" ||
    value === "policy_failed"
  );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function pushDiagnostic(
  diagnostics: string[],
  condition: boolean,
  diagnostic: string,
): void {
  if (condition) diagnostics.push(diagnostic);
}

function invalidReview(): Error {
  return new Error("Execution plan blueprint outcome review is invalid");
}
