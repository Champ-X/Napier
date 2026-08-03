import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordSelection,
  JsonValue,
  SaveExecutionPlanBlueprintResult,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  setBodyContentSha256Header,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setExecutionPlanBlueprintRecordListHeaders(
  context: Context,
  records: readonly ExecutionPlanBlueprintRecord[],
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, records);
  context.header("X-Napier-Plan-Blueprint-Count", String(records.length));
  context.header(
    "X-Napier-Plan-Blueprint-Active-Count",
    String(records.filter((record) => record.status === "active").length),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Archived-Count",
    String(records.filter((record) => record.status === "archived").length),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Set-SHA256",
    sha256Json(records.map((record) => record.blueprintSha256).sort()),
  );
}

export function setExecutionPlanBlueprintRecordHeaders(
  context: Context,
  record: ExecutionPlanBlueprintRecord,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, record);
  setExecutionPlanBlueprintRecordMetadataHeaders(context, record);
  context.header(
    "X-Napier-Plan-Step-Count",
    String(record.blueprint.stepCount),
  );
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(record.blueprint.artifactCount),
  );
}

export function setExecutionPlanBlueprintRecordQualificationHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordQualification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, qualification);
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header("X-Napier-Plan-Blueprint-Record-Id", qualification.recordId);
  context.header(
    "X-Napier-Diagnostic-Count",
    String(qualification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  context.header("X-Napier-Plan-Step-Count", String(qualification.stepCount));
  context.header(
    "X-Napier-Plan-Artifact-Count",
    String(qualification.artifactCount),
  );
  setTruthyHeader(
    context,
    "X-Napier-Plan-Blueprint-Status",
    qualification.recordStatus,
  );
  setTruthyHeader(
    context,
    "X-Napier-Plan-Blueprint-SHA256",
    qualification.blueprintSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Source-Thread-Id",
    qualification.sourceThreadId,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Source-Plan-Id",
    qualification.sourcePlanId,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blueprint-Source-Plan-Revision",
    qualification.sourcePlanRevision,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Source-Archive-SHA256",
    qualification.expectedPlanArchiveSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    qualification.expectedEventStreamSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Blueprint-Actual-Source-Plan-Revision",
    qualification.actualSourcePlanRevision,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Actual-Source-Archive-SHA256",
    qualification.actualPlanArchiveSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Actual-Source-Event-Stream-SHA256",
    qualification.actualEventStreamSha256,
  );
}

export function setExecutionPlanBlueprintSaveResultHeaders(
  context: Context,
  result: SaveExecutionPlanBlueprintResult,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Plan-Blueprint-Created", String(result.created));
  setExecutionPlanBlueprintRecordMetadataHeaders(context, result.record);
}

export function setExecutionPlanBlueprintRecordSelectionHeaders(
  context: Context,
  selection: ExecutionPlanBlueprintRecordSelection,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, selection.contentSha256);
  context.header("X-Napier-Thread-Id", selection.threadId);
  context.header(
    "X-Napier-Plan-Blueprint-Candidate-Count",
    String(selection.candidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Qualified-Candidate-Count",
    String(selection.qualifiedCandidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Rejected-Candidate-Count",
    String(selection.rejectedCandidateCount),
  );
  context.header(
    "X-Napier-Plan-Blueprint-Selection-Set-SHA256",
    selection.selectionSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Portfolio-Set-SHA256",
    selection.portfolioSetSha256,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-Template",
    selection.recommendationPolicy.templateId,
  );
  context.header(
    "X-Napier-Blueprint-Recommendation-Policy-SHA256",
    selection.recommendationPolicySha256,
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Count",
    String(selection.familyPolicyOverrideCount),
  );
  context.header(
    "X-Napier-Blueprint-Family-Policy-Override-Set-SHA256",
    selection.familyPolicyOverrideSetSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Objective-SHA256",
    selection.objectiveSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Plan-Blueprint-Record-Id",
    selection.selectedRecordId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Preview-SHA256",
    selection.selectedPreviewSha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Outcome-Baseline-Id",
    selection.selectedBaselineId,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Outcome-Baseline-SHA256",
    selection.selectedBaselineSha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Score-BPS",
    selection.selectedScoreBps,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-SHA256",
    selection.selectedFamilySha256,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-Completion-Rate-BPS",
    selection.selectedFamilyCompletionRateBps,
  );
  setOptionalNumberHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Score-BPS",
    selection.selectedRecommendationScoreBps,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-Template",
    selection.selectedRecommendationPolicyTemplate,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-SHA256",
    selection.selectedRecommendationPolicySha256,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Recommendation-Policy-Source",
    selection.selectedRecommendationPolicySource,
  );
  setOptionalHeader(
    context,
    "X-Napier-Selected-Blueprint-Family-Policy-Override-SHA256",
    selection.selectedFamilyPolicyOverrideSha256,
  );
}

export function setExecutionPlanBlueprintRecordQualificationMetadataHeaders(
  context: Context,
  qualification: ExecutionPlanBlueprintRecordQualification,
): void {
  context.header("X-Napier-Qualification-Status", qualification.status);
  context.header(
    "X-Napier-Blueprint-Qualification-SHA256",
    sha256Json(qualification as unknown as JsonValue),
  );
  context.header(
    "X-Napier-Blueprint-Qualification-Diagnostics-SHA256",
    sha256Json(qualification.diagnostics),
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Actual-Source-Archive-SHA256",
    qualification.actualPlanArchiveSha256,
  );
  setTruthyHeader(
    context,
    "X-Napier-Blueprint-Actual-Source-Event-Stream-SHA256",
    qualification.actualEventStreamSha256,
  );
}

export function setExecutionPlanBlueprintRecordMetadataHeaders(
  context: Context,
  record: ExecutionPlanBlueprintRecord,
): void {
  context.header("X-Napier-Plan-Blueprint-Record-Id", record.id);
  context.header("X-Napier-Plan-Blueprint-Status", record.status);
  context.header("X-Napier-Plan-Blueprint-SHA256", record.blueprintSha256);
  context.header("X-Napier-Blueprint-Source-Thread-Id", record.sourceThreadId);
  context.header("X-Napier-Blueprint-Source-Plan-Id", record.sourcePlanId);
  context.header(
    "X-Napier-Blueprint-Source-Plan-Revision",
    String(record.sourcePlanRevision),
  );
  context.header(
    "X-Napier-Blueprint-Source-Archive-SHA256",
    record.sourcePlanArchiveSha256,
  );
  context.header(
    "X-Napier-Blueprint-Source-Event-Stream-SHA256",
    record.sourceEventStreamSha256,
  );
}

function setOptionalHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) context.header(name, value);
}

function setTruthyHeader(
  context: Context,
  name: string,
  value: string | undefined,
): void {
  if (value) context.header(name, value);
}

function setOptionalNumberHeader(
  context: Context,
  name: string,
  value: number | undefined,
): void {
  if (value !== undefined) context.header(name, String(value));
}
