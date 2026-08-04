import type {
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setExecutionPlanBlueprintRecordOutcomeReviewHeaders(
  context: Context,
  review: ExecutionPlanBlueprintRecordOutcomeReview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.reviewSha256);
  context.header("X-Napier-Plan-Blueprint-Record-Id", review.recordId);
  context.header("X-Napier-Plan-Blueprint-SHA256", review.blueprintSha256);
  context.header("X-Napier-Blueprint-Outcome-Review-Verdict", review.verdict);
  context.header("X-Napier-Blueprint-Outcome-Review-Risk", review.risk);
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Score",
    String(review.score),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-SHA256",
    review.reviewSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Input-SHA256",
    review.inputSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Prompt-SHA256",
    review.promptSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Response-SHA256",
    review.responseSha256,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Review-Schema-SHA256",
    review.reviewSchemaSha256,
  );
  if (review.modelContextEnvelope) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Model-Context-Envelope-SHA256",
      review.modelContextEnvelope.contentSha256,
    );
  }
  context.header("X-Napier-Model-Provider", review.model.provider);
  context.header("X-Napier-Model-Id", review.model.id);
  context.header(
    "X-Napier-Blueprint-Source-Qualification-Status",
    review.sourceQualificationStatus,
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Qualification-Status",
    review.outcomeQualificationStatus,
  );
  setOutcomeMetricsHeaders(context, review);
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-Id",
    review.baselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    review.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Baseline-Outcomes-SHA256",
    review.baselineOutcomesSha256,
  );
}

export function setExecutionPlanBlueprintRecordOutcomeBaselineListHeaders(
  context: Context,
  baselines: readonly ExecutionPlanBlueprintRecordOutcomeBaseline[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-Count",
    String(baselines.length),
  );
  const latest = baselines.at(-1);
  if (latest) setOutcomeBaselineMetadataHeaders(context, latest);
}

export function setExecutionPlanBlueprintRecordOutcomeBaselinePromotionHeaders(
  context: Context,
  result: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-Created",
    String(result.created),
  );
  setOutcomeBaselineMetadataHeaders(context, result.baseline);
}

export function setExecutionPlanBlueprintRecordOutcomeQualificationHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordOutcomeQualification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, qualification.contentSha256);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  context.header("X-Napier-Plan-Blueprint-Record-Id", qualification.recordId);
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-Id",
    qualification.baselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    qualification.baselineSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Baseline-Outcomes-SHA256",
    qualification.baselineOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Current-Outcomes-SHA256",
    qualification.currentOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    qualification.currentReplayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    qualification.currentOutcomeSetSha256,
  );
  setOutcomeCountHeaders(context, qualification);
  if (qualification.policy) {
    setOutcomePolicyHeaders(context, qualification.policy);
  }
}

function setOutcomeBaselineMetadataHeaders(
  context: Context,
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline,
): void {
  context.header("X-Napier-Plan-Blueprint-Record-Id", baseline.recordId);
  context.header("X-Napier-Blueprint-Outcome-Baseline-Id", baseline.id);
  context.header(
    "X-Napier-Blueprint-Outcome-Baseline-SHA256",
    baseline.contentSha256,
  );
  setOutcomeMetricsHeaders(context, baseline);
  setOutcomePolicyHeaders(context, baseline.policy);
  if (baseline.reviewGate) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Gate-Min-Score",
      String(baseline.reviewGate.minScore),
    );
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Gate-Max-Risk",
      baseline.reviewGate.maxRisk,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-SHA256",
    baseline.reviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Input-SHA256",
    baseline.reviewInputSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Response-SHA256",
    baseline.reviewResponseSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Verdict",
    baseline.reviewVerdict,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Score",
    baseline.reviewScore,
  );
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Review-Risk",
    baseline.reviewRisk,
  );
  if (baseline.reviewModel) {
    context.header(
      "X-Napier-Blueprint-Outcome-Review-Model",
      `${baseline.reviewModel.provider}/${baseline.reviewModel.id}`,
    );
  }
  setOptionalHeader(
    context,
    "X-Napier-Blueprint-Outcome-Supersedes-Baseline-Id",
    baseline.supersedesBaselineId,
  );
}

function setOutcomeMetricsHeaders(
  context: Context,
  value: {
    replayOutcomesSha256: string;
    replayHistorySha256: string;
    outcomeSetSha256: string;
    replayCount: number;
    completedCount: number;
    blockedCount: number;
    invalidCount: number;
    completionRateBps: number;
  },
): void {
  context.header(
    "X-Napier-Blueprint-Replay-Outcomes-SHA256",
    value.replayOutcomesSha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-History-SHA256",
    value.replayHistorySha256,
  );
  context.header(
    "X-Napier-Blueprint-Replay-Outcome-Set-SHA256",
    value.outcomeSetSha256,
  );
  setOutcomeCountHeaders(context, value);
}

function setOutcomeCountHeaders(
  context: Context,
  value: {
    replayCount: number;
    completedCount: number;
    blockedCount: number;
    invalidCount: number;
    completionRateBps: number;
  },
): void {
  context.header("X-Napier-Blueprint-Replay-Count", String(value.replayCount));
  context.header(
    "X-Napier-Blueprint-Replay-Completed-Count",
    String(value.completedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Blocked-Count",
    String(value.blockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Invalid-Count",
    String(value.invalidCount),
  );
  context.header(
    "X-Napier-Blueprint-Replay-Completion-Rate-BPS",
    String(value.completionRateBps),
  );
}

function setOutcomePolicyHeaders(
  context: Context,
  policy: {
    minReplayCount: number;
    minCompletionRateBps: number;
    maxBlockedCount: number;
    maxInvalidCount: number;
  },
): void {
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Min-Replay-Count",
    String(policy.minReplayCount),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Min-Completion-Rate-BPS",
    String(policy.minCompletionRateBps),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Max-Blocked-Count",
    String(policy.maxBlockedCount),
  );
  context.header(
    "X-Napier-Blueprint-Outcome-Policy-Max-Invalid-Count",
    String(policy.maxInvalidCount),
  );
}

function setOptionalHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) context.header(name, value);
}

function setOptionalNumberHeader(
  context: Context,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) context.header(name, String(value));
}
