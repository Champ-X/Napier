import type {
  ApplyExtensionPackageDeploymentRequest,
  ApplyExtensionPackageDeploymentResult,
  ApplyExtensionPackageRolloutChannelRequest,
  ApplyExtensionPackageRolloutChannelResult,
  ApplyExtensionPackageUpdateRequest,
  ApplyExtensionPackageUpdateResult,
  BootstrapResponse,
  CreateBranchRequest,
  ContextCheckpointCalibrationReport,
  CreateExecutionPlanFromBlueprintRequest,
  CreateExecutionPlanFromBlueprintRecordRequest,
  CreateEvaluationSuiteRequest,
  EventCategory,
  EventVisibility,
  CreateExtensionPublisherTrustAnchorRequest,
  CreateMcpExtensionRequest,
  CreateMemoryRequest,
  CreateRunEvaluationRequest,
  CreateThreadRequest,
  EvaluationAdjudication,
  EvaluationCalibrationReport,
  EvaluationConsensusReport,
  EvaluationReviewerBallot,
  ExecutionPlan,
  ExecutionPlanReplanDraftModelReview,
  ExportExtensionPackageLockfileRequest,
  ExtensionRecord,
  ExtensionPackageVerification,
  ExtensionPackageDeploymentPreview,
  ExtensionPackageLockfile,
  ExtensionPackageLockfileVerification,
  ExtensionPackageRolloutChannel,
  ExtensionPackageRolloutPreview,
  ExtensionPackageUpdatePreview,
  ExtensionPublisherTrustAnchor,
  EvaluationSuite,
  EvaluationSuiteExecution,
  EvaluationSuiteGateReceipt,
  ExecutionPlanArchive,
  ExecutionPlanArchiveVerification,
  ExecutionPlanBlueprint,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintPortfolioCalibration,
  ExecutionPlanBlueprintRecommendationPolicyBacktest,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  ExecutionPlanBlueprintRecommendationPolicyOverrideList,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  ExecutionPlanBlueprintVerification,
  HealthResponse,
  ImportThreadReplayBundleRequest,
  ImportSignedExtensionPackageRequest,
  MemoryFact,
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
  PreviewExtensionPackageDeploymentRequest,
  PublishExtensionPackageRolloutChannelRequest,
  PreviewExtensionPackageUpdateRequest,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  PromptRequest,
  ReplanExecutionPlanRequest,
  ResumeRunRequest,
  ReviewExtensionRequest,
  ReviewExecutionPlanBlueprintRecordOutcomesRequest,
  ReviewExecutionPlanReplanDraftRequest,
  ReviewMemoryRequest,
  ReviewMcpToolRequest,
  ReviewRunEvaluationRequest,
  ResolveEvaluationConsensusRequest,
  ResolveEvaluationConsensusResult,
  RunComparison,
  RunEvaluationRecord,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  SignedExtensionPackageChannelIndexEnvelope,
  SignedExtensionPackageEnvelope,
  SignExtensionPackageChannelIndexRequest,
  SignExtensionPackageRequest,
  SetExtensionEnabledRequest,
  SetExecutionPlanBlueprintRecordStatusRequest,
  SelectExecutionPlanBlueprintRecordRequest,
  SetGoalRequest,
  SaveExecutionPlanBlueprintRequest,
  SaveExecutionPlanBlueprintResult,
  StreamFrame,
  SubmitEvaluationReviewerBallotRequest,
  ThreadDetail,
  ThreadStatus,
  ThreadReplayBundle,
  UpdateEvaluationSuiteRequest,
  UsagePriceTableCatalog,
  UsagePriceTableVerification,
  VerifyUsagePriceTableCatalogRequest,
  ExtensionPackageChannelIndexVerification,
  VerifyExtensionPackageLockfileRequest,
  VerifyExtensionPackageChannelIndexRequest,
  VerifyExecutionPlanBlueprintRequest,
  VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  VerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
  VerifyExecutionPlanArchiveRequest,
  VerifyOpenTelemetryTraceArtifactRequest,
  VerifySignedExtensionPackageRequest,
  VerifyRunReplaySnapshotRequest,
  VerifyThreadReplayBundleRequest,
  ThreadReplayBundleVerification,
} from "@napier/contracts";

import { requestJson, requestJsonWithResponse } from "./api-client";
import {
  NapierStreamDoneEventCountError,
  NapierStreamDoneEventStreamHashError,
  NapierStreamDoneSnapshotHashError,
  NapierStreamEventHashError,
  NapierStreamFrameContractError,
  NapierStreamFrameEventTypeError,
  NapierStreamFrameIdError,
  NapierStreamFrameOrderError,
  NapierStreamFrameParseError,
  NapierStreamRunIdentityError,
  NapierStreamResponseContractError,
  NapierStreamSnapshotEventError,
  NapierStreamSnapshotMissingError,
  NapierStreamSnapshotRunError,
  NapierStreamSnapshotHashError,
  NapierStreamTerminationError,
  NapierStreamEventSequenceError,
  NapierStreamThreadIdentityError,
  type NapierStreamFrameContractReason,
  sha256Text,
  throwNapierApiError,
} from "./api-error";

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const THREAD_STATUSES = new Set<ThreadStatus>([
  "idle",
  "running",
  "waiting",
  "failed",
]);
const EVENT_CATEGORIES = new Set<EventCategory>([
  "lifecycle",
  "message",
  "model",
  "tool",
  "artifact",
  "goal",
  "plan",
  "memory",
  "subagent",
  "extension",
  "credential",
  "evaluation",
  "automation",
  "channel",
  "system",
]);

export interface CreatedExecutionPlanFromBlueprintRecord {
  plan: ExecutionPlan;
  replayEvent?: VerifyExecutionPlanBlueprintRecordReplayEventRequest;
}
const EVENT_VISIBILITIES = new Set<EventVisibility>([
  "user",
  "debug",
  "hidden",
]);
const THREAD_DETAIL_ARRAY_FIELDS = [
  "runs",
  "plans",
  "evaluations",
  "evaluationAdjudications",
  "evaluationReviewerBallots",
  "evaluationConsensusResolutions",
  "evaluationSuites",
  "evaluationSuiteExecutions",
  "automaticRecoveryAssessments",
  "automaticRecoveryAttempts",
  "subagents",
] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const RUN_STREAM_ERROR_MESSAGE = "Run failed while streaming.";
const RUN_STREAM_ERROR_CODE = "run_failed";

export function getBootstrap(threadId?: string): Promise<BootstrapResponse> {
  const query = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
  return requestJson(`/api/bootstrap${query}`);
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson("/api/health");
}

export function getThread(threadId: string): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}`);
}

export function getRunReplay(
  threadId: string,
  runId: string,
): Promise<RunReplaySnapshot> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/replay`,
  );
}

export function verifyRunReplaySnapshot(
  threadId: string,
  runId: string,
  body: VerifyRunReplaySnapshotRequest,
): Promise<RunReplaySnapshotVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/replay/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getThreadReplayBundle(
  threadId: string,
): Promise<ThreadReplayBundle> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/fixture`);
}

export function exportOpenTelemetryTrace(
  threadId: string,
  runId?: string,
): Promise<OpenTelemetryTraceArtifact> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/trace/otlp`,
    {
      method: "POST",
      body: JSON.stringify(runId ? { runId } : {}),
    },
  );
}

export function verifyOpenTelemetryTraceArtifact(
  threadId: string,
  body: VerifyOpenTelemetryTraceArtifactRequest,
): Promise<OpenTelemetryTraceArtifactVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/trace/otlp/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function importThreadReplayBundle(
  body: ImportThreadReplayBundleRequest,
): Promise<ThreadDetail> {
  return requestJson("/api/threads/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyThreadReplayBundle(
  body: VerifyThreadReplayBundleRequest,
): Promise<ThreadReplayBundleVerification> {
  return requestJson("/api/threads/import/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function compareThreadRuns(
  threadId: string,
  leftRunId: string,
  rightRunId: string,
): Promise<RunComparison> {
  const query = new URLSearchParams({
    left: leftRunId,
    right: rightRunId,
  });
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/compare?${query.toString()}`,
  );
}

export function createRunEvaluation(
  threadId: string,
  body: CreateRunEvaluationRequest,
): Promise<RunEvaluationRecord> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluations`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function reviewRunEvaluation(
  threadId: string,
  evaluationId: string,
  body: ReviewRunEvaluationRequest,
): Promise<EvaluationAdjudication> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluations/${encodeURIComponent(evaluationId)}/adjudication`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function submitEvaluationReviewerBallot(
  threadId: string,
  evaluationId: string,
  body: SubmitEvaluationReviewerBallotRequest,
): Promise<EvaluationReviewerBallot> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluations/${encodeURIComponent(evaluationId)}/reviewer-ballots`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function previewEvaluationConsensus(
  threadId: string,
  evaluationId: string,
  body: ResolveEvaluationConsensusRequest,
): Promise<EvaluationConsensusReport> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluations/${encodeURIComponent(evaluationId)}/consensus/preview`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function resolveEvaluationConsensus(
  threadId: string,
  evaluationId: string,
  body: ResolveEvaluationConsensusRequest,
): Promise<ResolveEvaluationConsensusResult> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluations/${encodeURIComponent(evaluationId)}/consensus/resolve`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function reviewReplanDraft(
  threadId: string,
  planId: string,
  body: ReviewExecutionPlanReplanDraftRequest,
): Promise<ExecutionPlanReplanDraftModelReview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/replan-draft-review`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function applyReplanDraft(
  threadId: string,
  planId: string,
  body: ReplanExecutionPlanRequest,
): Promise<ExecutionPlan> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/replan`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanArchive(
  threadId: string,
  planId: string,
): Promise<ExecutionPlanArchive> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/archive`,
  );
}

export function verifyExecutionPlanArchive(
  threadId: string,
  planId: string,
  body: VerifyExecutionPlanArchiveRequest,
): Promise<ExecutionPlanArchiveVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/archive/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanBlueprint(
  threadId: string,
  planId: string,
): Promise<ExecutionPlanBlueprint> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/blueprint`,
  );
}

export function verifyExecutionPlanBlueprint(
  threadId: string,
  body: VerifyExecutionPlanBlueprintRequest,
): Promise<ExecutionPlanBlueprintVerification> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/blueprints/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createExecutionPlanFromBlueprint(
  threadId: string,
  body: CreateExecutionPlanFromBlueprintRequest,
): Promise<ExecutionPlan> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/from-blueprint`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanBlueprintRecords(
  status?: ExecutionPlanBlueprintRecord["status"],
): Promise<ExecutionPlanBlueprintRecord[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson(`/api/plan-blueprints${query}`);
}

export function getExecutionPlanBlueprintRecordQualification(
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordQualification> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/qualification`,
  );
}

export function getExecutionPlanBlueprintRecordReplays(
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordReplayHistory> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays`,
  );
}

export function verifyExecutionPlanBlueprintRecordReplays(
  recordId: string,
  body: VerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
): Promise<ExecutionPlanBlueprintRecordReplayHistoryVerification> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanBlueprintRecordReplayOutcomes(
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordReplayOutcomes> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes`,
  );
}

export function verifyExecutionPlanBlueprintRecordReplayOutcomes(
  recordId: string,
  body: VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
): Promise<ExecutionPlanBlueprintRecordReplayOutcomesVerification> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanBlueprintRecordOutcomeBaselines(
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordOutcomeBaseline[]> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes/baselines`,
  );
}

export function getExecutionPlanBlueprintPortfolioCalibration(): Promise<ExecutionPlanBlueprintPortfolioCalibration> {
  return requestJson("/api/plan-blueprints/portfolio/calibration");
}

export function getExecutionPlanBlueprintRecommendationPolicyBacktest(): Promise<ExecutionPlanBlueprintRecommendationPolicyBacktest> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-backtest",
  );
}

export function getExecutionPlanBlueprintRecommendationPolicyOverrides(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideList> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
  );
}

export function getExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review",
  );
}

export function getExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements",
  );
}

export function verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
  body: VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest,
): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function setExecutionPlanBlueprintRecommendationPolicyOverride(
  body: SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
): Promise<ExecutionPlanBlueprintRecommendationPolicyOverride> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function retireExecutionPlanBlueprintRecommendationPolicyOverride(
  body: RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
): Promise<RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function promoteExecutionPlanBlueprintRecordOutcomeBaseline(
  recordId: string,
  body: PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
): Promise<PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes/baselines`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function getExecutionPlanBlueprintRecordOutcomeQualification(
  recordId: string,
): Promise<ExecutionPlanBlueprintRecordOutcomeQualification> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes/qualification`,
  );
}

export function reviewExecutionPlanBlueprintRecordOutcomes(
  recordId: string,
  body: ReviewExecutionPlanBlueprintRecordOutcomesRequest,
): Promise<ExecutionPlanBlueprintRecordOutcomeReview> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/outcomes/review`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function selectExecutionPlanBlueprintRecord(
  threadId: string,
  body: SelectExecutionPlanBlueprintRecordRequest = {},
): Promise<ExecutionPlanBlueprintRecordSelection> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plan-blueprints/selection`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifyExecutionPlanBlueprintRecordReplayEvent(
  recordId: string,
  body: VerifyExecutionPlanBlueprintRecordReplayEventRequest,
): Promise<ExecutionPlanBlueprintRecordReplayEventVerification> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/replays/events/verify`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function saveExecutionPlanBlueprint(
  threadId: string,
  body: SaveExecutionPlanBlueprintRequest,
): Promise<SaveExecutionPlanBlueprintResult> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plan-blueprints`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function setExecutionPlanBlueprintRecordStatus(
  recordId: string,
  body: SetExecutionPlanBlueprintRecordStatusRequest,
): Promise<ExecutionPlanBlueprintRecord> {
  return requestJson(
    `/api/plan-blueprints/${encodeURIComponent(recordId)}/status`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function previewExecutionPlanFromBlueprintRecord(
  threadId: string,
  body: CreateExecutionPlanFromBlueprintRecordRequest,
): Promise<ExecutionPlanBlueprintRecordPreview> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/from-blueprint-record/preview`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function createExecutionPlanFromBlueprintRecord(
  threadId: string,
  body: CreateExecutionPlanFromBlueprintRecordRequest,
): Promise<ExecutionPlan> {
  return createExecutionPlanFromBlueprintRecordWithReplayEvent(
    threadId,
    body,
  ).then((result) => result.plan);
}

export async function createExecutionPlanFromBlueprintRecordWithReplayEvent(
  threadId: string,
  body: CreateExecutionPlanFromBlueprintRecordRequest,
): Promise<CreatedExecutionPlanFromBlueprintRecord> {
  const response = await requestJsonWithResponse<ExecutionPlan>(
    `/api/threads/${encodeURIComponent(threadId)}/plans/from-blueprint-record`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  const replayEvent = blueprintReplayEventFromHeaders(
    threadId,
    response.headers,
  );
  return {
    plan: response.body,
    ...(replayEvent ? { replayEvent } : {}),
  };
}

function blueprintReplayEventFromHeaders(
  threadId: string,
  headers: Headers,
): VerifyExecutionPlanBlueprintRecordReplayEventRequest | undefined {
  const eventId = headers.get("x-napier-blueprint-replay-event-id");
  const seqText = headers.get("x-napier-blueprint-replay-event-seq");
  const eventSha256 = headers.get("x-napier-blueprint-replay-event-sha256");
  const seq = seqText ? Number(seqText) : NaN;
  if (
    !eventId ||
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    !isSha256Hex(eventSha256)
  ) {
    return undefined;
  }
  return {
    threadId,
    eventId,
    seq,
    eventSha256,
  };
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function getEvaluationCalibration(
  threadId: string,
): Promise<EvaluationCalibrationReport> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-calibration`,
  );
}

export function getContextCheckpointCalibration(
  threadId: string,
): Promise<ContextCheckpointCalibrationReport> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/context-checkpoint-calibration`,
  );
}

export function getUsagePriceTableCatalog(): Promise<UsagePriceTableCatalog> {
  return requestJson("/api/usage-price-tables");
}

export function verifyUsagePriceTableCatalog(
  body: VerifyUsagePriceTableCatalogRequest,
): Promise<UsagePriceTableVerification> {
  return requestJson("/api/usage-price-tables/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createEvaluationSuite(
  threadId: string,
  body: CreateEvaluationSuiteRequest,
): Promise<EvaluationSuite> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function updateEvaluationSuite(
  threadId: string,
  suiteId: string,
  body: UpdateEvaluationSuiteRequest,
): Promise<EvaluationSuite> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites/${encodeURIComponent(suiteId)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export function executeEvaluationSuite(
  threadId: string,
  suiteId: string,
): Promise<EvaluationSuiteExecution> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites/${encodeURIComponent(suiteId)}/executions`,
    { method: "POST" },
  );
}

export function getEvaluationSuiteGateReceipt(
  threadId: string,
  suiteId: string,
): Promise<EvaluationSuiteGateReceipt> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/evaluation-suites/${encodeURIComponent(suiteId)}/receipt`,
  );
}

export function createThread(
  body: CreateThreadRequest = {},
): Promise<ThreadDetail> {
  return requestJson("/api/threads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function setGoal(
  threadId: string,
  body: SetGoalRequest,
): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function clearGoal(threadId: string): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
    method: "DELETE",
  });
}

export function createBranch(
  threadId: string,
  body: CreateBranchRequest,
): Promise<ThreadDetail> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/branches`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function stopRun(threadId: string): Promise<{ stopped: boolean }> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/stop`, {
    method: "POST",
  });
}

export function proposeMemory(body: CreateMemoryRequest): Promise<MemoryFact> {
  return requestJson("/api/memories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reviewMemory(
  memoryId: string,
  body: ReviewMemoryRequest,
): Promise<MemoryFact> {
  return requestJson(`/api/memories/${encodeURIComponent(memoryId)}/review`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createMcpExtension(
  body: CreateMcpExtensionRequest,
): Promise<ExtensionRecord> {
  return requestJson("/api/extensions/mcp", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reviewExtension(
  extensionId: string,
  body: ReviewExtensionRequest,
): Promise<ExtensionRecord> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/review`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function setExtensionEnabled(
  extensionId: string,
  body: SetExtensionEnabledRequest,
): Promise<ExtensionRecord> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/enabled`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function connectExtension(
  extensionId: string,
  threadId?: string,
): Promise<ExtensionRecord> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/connect`,
    {
      method: "POST",
      body: JSON.stringify(threadId ? { threadId } : {}),
    },
  );
}

export function disconnectExtension(
  extensionId: string,
  threadId?: string,
): Promise<ExtensionRecord> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/disconnect`,
    {
      method: "POST",
      body: JSON.stringify(threadId ? { threadId } : {}),
    },
  );
}

export function reviewMcpTool(
  extensionId: string,
  toolName: string,
  body: ReviewMcpToolRequest,
): Promise<ExtensionRecord> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/tools/review`,
    {
      method: "POST",
      body: JSON.stringify({ ...body, toolName }),
    },
  );
}

export function createExtensionPublisherTrustAnchor(
  body: CreateExtensionPublisherTrustAnchorRequest,
): Promise<ExtensionPublisherTrustAnchor> {
  return requestJson("/api/extensions/publishers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function revokeExtensionPublisherTrustAnchor(
  anchorId: string,
  threadId: string,
): Promise<ExtensionPublisherTrustAnchor> {
  return requestJson(
    `/api/extensions/publishers/${encodeURIComponent(anchorId)}/revoke`,
    {
      method: "POST",
      body: JSON.stringify({ threadId }),
    },
  );
}

export function signExtensionPackage(
  extensionId: string,
  body: SignExtensionPackageRequest,
): Promise<SignedExtensionPackageEnvelope> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/package/sign`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function verifySignedExtensionPackage(
  body: VerifySignedExtensionPackageRequest,
): Promise<ExtensionPackageVerification> {
  return requestJson("/api/extensions/packages/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function importSignedExtensionPackage(
  body: ImportSignedExtensionPackageRequest,
): Promise<ExtensionRecord> {
  return requestJson("/api/extensions/packages/import", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function exportExtensionPackageLockfile(
  body: ExportExtensionPackageLockfileRequest,
): Promise<ExtensionPackageLockfile> {
  return requestJson("/api/extensions/packages/lockfile/export", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyExtensionPackageLockfile(
  body: VerifyExtensionPackageLockfileRequest,
): Promise<ExtensionPackageLockfileVerification> {
  return requestJson("/api/extensions/packages/lockfile/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function signExtensionPackageChannelIndex(
  body: SignExtensionPackageChannelIndexRequest,
): Promise<SignedExtensionPackageChannelIndexEnvelope> {
  return requestJson("/api/extensions/packages/channel-index/sign", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function verifyExtensionPackageChannelIndex(
  body: VerifyExtensionPackageChannelIndexRequest,
): Promise<ExtensionPackageChannelIndexVerification> {
  return requestJson("/api/extensions/packages/channel-index/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function previewExtensionPackageDeployment(
  body: PreviewExtensionPackageDeploymentRequest,
): Promise<ExtensionPackageDeploymentPreview> {
  return requestJson("/api/extensions/packages/deployment/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function applyExtensionPackageDeployment(
  body: ApplyExtensionPackageDeploymentRequest,
): Promise<ApplyExtensionPackageDeploymentResult> {
  return requestJson("/api/extensions/packages/deployment", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function publishExtensionPackageRolloutChannel(
  body: PublishExtensionPackageRolloutChannelRequest,
): Promise<ExtensionPackageRolloutChannel> {
  return requestJson("/api/extensions/packages/rollouts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function previewExtensionPackageRolloutChannel(
  channelId: string,
): Promise<ExtensionPackageRolloutPreview> {
  return requestJson(
    `/api/extensions/packages/rollouts/${encodeURIComponent(channelId)}/preview`,
    { method: "POST" },
  );
}

export function applyExtensionPackageRolloutChannel(
  channelId: string,
  body: Omit<ApplyExtensionPackageRolloutChannelRequest, "channelId">,
): Promise<ApplyExtensionPackageRolloutChannelResult> {
  return requestJson(
    `/api/extensions/packages/rollouts/${encodeURIComponent(channelId)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function previewExtensionPackageUpdate(
  extensionId: string,
  body: PreviewExtensionPackageUpdateRequest,
): Promise<ExtensionPackageUpdatePreview> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/package/update/preview`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function applyExtensionPackageUpdate(
  extensionId: string,
  body: ApplyExtensionPackageUpdateRequest,
): Promise<ApplyExtensionPackageUpdateResult> {
  return requestJson(
    `/api/extensions/${encodeURIComponent(extensionId)}/package/update`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function streamPrompt(
  threadId: string,
  body: PromptRequest,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  return streamRunFrames(
    `/api/threads/${encodeURIComponent(threadId)}/messages`,
    body,
    {
      kind: "prompt",
      threadId,
      ...(body.model ? { model: body.model } : {}),
    },
    onFrame,
  );
}

export async function resumeInterruptedRun(
  threadId: string,
  body: ResumeRunRequest,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  return streamRunFrames(
    `/api/threads/${encodeURIComponent(threadId)}/resume`,
    body,
    {
      kind: "resume",
      threadId,
      ...(body.runId ? { runId: body.runId } : {}),
      ...(body.model ? { model: body.model } : {}),
    },
    onFrame,
  );
}

type StreamRunExpectation =
  | {
      kind: "prompt";
      threadId: string;
      model?: PromptRequest["model"];
    }
  | {
      kind: "resume";
      threadId: string;
      runId?: string;
      model?: ResumeRunRequest["model"];
    };

interface ParsedStreamFrame {
  frame: StreamFrame;
  frameSha256: string;
}

async function streamRunFrames(
  path: string,
  body: PromptRequest | ResumeRunRequest,
  expectation: StreamRunExpectation,
  onFrame: (frame: StreamFrame) => void,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    await throwNapierApiError(response, "Run failed", path);
  }
  await verifyStreamRunResponseContract(path, response, expectation);
  if (!response.body) throw new Error("Streaming response is unavailable");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let frameCount = 0;
  let lastFrameType: StreamFrame["type"] | undefined;
  let terminalFrameType: StreamFrame["type"] | undefined;
  let lastEventSeq: number | undefined;
  const streamedEventSha256s = new Map<number, string>();
  let snapshotEventSha256s = new Map<number, string>();
  let hasSnapshotFrame = false;
  let snapshotRunStatuses = new Map<string, string>();
  let snapshotSha256: string | undefined;
  let snapshotEventCount: number | undefined;
  let snapshotEventStreamSha256: string | undefined;
  let streamRunId =
    expectation.kind === "resume" ? expectation.runId : undefined;
  const dispatchParsedFrame = async (
    parsed: ParsedStreamFrame | undefined,
  ): Promise<void> => {
    if (!parsed) return;
    const { frame, frameSha256 } = parsed;
    if (terminalFrameType) {
      throw new NapierStreamFrameOrderError(path, {
        frameCount,
        terminalFrameType,
        nextFrameType: frame.type,
      });
    }
    verifyStreamThreadIdentity(path, expectation.threadId, frame, frameSha256);
    streamRunId = verifyStreamRunIdentity(
      path,
      streamRunId,
      frame,
      frameSha256,
    );
    if (frame.type === "event") {
      if (lastEventSeq !== undefined && frame.event.seq <= lastEventSeq) {
        throw new NapierStreamEventSequenceError(path, {
          previousSeq: lastEventSeq,
          currentSeq: frame.event.seq,
          frameSha256,
        });
      }
      lastEventSeq = frame.event.seq;
      streamedEventSha256s.set(frame.event.seq, frame.eventSha256);
    }
    if (frame.type === "snapshot") {
      snapshotEventSha256s = await streamSnapshotEventSha256s(frame);
      verifyStreamSnapshotEvents(path, {
        streamedEventSha256s,
        snapshotEventSha256s,
        snapshotSha256: frame.detailSha256,
        frameSha256,
      });
      hasSnapshotFrame = true;
      snapshotRunStatuses = streamSnapshotRunStatuses(frame);
      snapshotSha256 = frame.detailSha256;
      snapshotEventCount = frame.detail.thread.eventCount;
      snapshotEventStreamSha256 = await streamSnapshotEventStreamSha256(frame);
    }
    if (frame.type === "done" && !hasSnapshotFrame) {
      throw new NapierStreamSnapshotMissingError(path, {
        frameCount,
        runId: frame.runId,
        status: frame.status,
        frameSha256,
      });
    }
    if (frame.type === "done" && snapshotSha256) {
      if (frame.snapshotSha256 !== snapshotSha256) {
        throw new NapierStreamDoneSnapshotHashError(path, {
          expectedSha256: snapshotSha256,
          actualSha256: frame.snapshotSha256,
          frameSha256,
        });
      }
      if (
        snapshotEventCount !== undefined &&
        frame.eventCount !== snapshotEventCount
      ) {
        throw new NapierStreamDoneEventCountError(path, {
          expectedEventCount: snapshotEventCount,
          actualEventCount: frame.eventCount,
          snapshotSha256,
          frameSha256,
        });
      }
      if (
        snapshotEventStreamSha256 !== undefined &&
        frame.eventStreamSha256 !== snapshotEventStreamSha256
      ) {
        throw new NapierStreamDoneEventStreamHashError(path, {
          expectedSha256: snapshotEventStreamSha256,
          actualSha256: frame.eventStreamSha256,
          frameSha256,
        });
      }
      const snapshotStatus = snapshotRunStatuses.get(frame.runId);
      if (!snapshotStatus) {
        throw new NapierStreamSnapshotRunError(path, {
          reason: "run_missing",
          runId: frame.runId,
          doneStatus: frame.status,
          snapshotSha256,
          frameSha256,
        });
      }
      if (snapshotStatus !== frame.status) {
        throw new NapierStreamSnapshotRunError(path, {
          reason: "status_mismatch",
          runId: frame.runId,
          doneStatus: frame.status,
          snapshotStatus,
          snapshotSha256,
          frameSha256,
        });
      }
      verifyStreamSnapshotEvents(path, {
        streamedEventSha256s,
        snapshotEventSha256s,
        snapshotSha256,
        frameSha256,
      });
    }
    onFrame(frame);
    frameCount += 1;
    lastFrameType = frame.type;
    if (frame.type === "done" || frame.type === "error") {
      terminalFrameType = frame.type;
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const records = buffer.split(/\r?\n\r?\n/);
    buffer = records.pop() ?? "";
    for (const record of records) {
      await dispatchParsedFrame(await parseStreamFrameRecord(path, record));
    }
  }
  if (buffer.trim()) {
    await dispatchParsedFrame(await parseStreamFrameRecord(path, buffer));
  }
  if (!terminalFrameType) {
    throw new NapierStreamTerminationError(path, {
      frameCount,
      ...(lastFrameType ? { lastFrameType } : {}),
    });
  }
}

function streamSnapshotRunStatuses(
  frame: Extract<StreamFrame, { type: "snapshot" }>,
): Map<string, string> {
  return new Map(frame.detail.runs.map((run) => [run.id, run.status]));
}

async function streamSnapshotEventSha256s(
  frame: Extract<StreamFrame, { type: "snapshot" }>,
): Promise<Map<number, string>> {
  const entries = await Promise.all(
    frame.detail.events.map(
      async (event) =>
        [event.seq, await sha256Text(JSON.stringify(event))] as const,
    ),
  );
  return new Map(entries);
}

async function streamSnapshotEventStreamSha256(
  frame: Extract<StreamFrame, { type: "snapshot" }>,
): Promise<string> {
  return sha256Text(
    frame.detail.events.map((event) => JSON.stringify(event)).join("\n"),
  );
}

function verifyStreamSnapshotEvents(
  path: string,
  options: {
    streamedEventSha256s: ReadonlyMap<number, string>;
    snapshotEventSha256s: ReadonlyMap<number, string>;
    snapshotSha256: string;
    frameSha256: string;
  },
): void {
  for (const [seq, expectedSha256] of options.streamedEventSha256s) {
    const actualSha256 = options.snapshotEventSha256s.get(seq);
    if (!actualSha256) {
      throw new NapierStreamSnapshotEventError(path, {
        reason: "event_missing",
        seq,
        expectedSha256,
        snapshotSha256: options.snapshotSha256,
        frameSha256: options.frameSha256,
      });
    }
    if (actualSha256 !== expectedSha256) {
      throw new NapierStreamSnapshotEventError(path, {
        reason: "event_mismatch",
        seq,
        expectedSha256,
        actualSha256,
        snapshotSha256: options.snapshotSha256,
        frameSha256: options.frameSha256,
      });
    }
  }
}

function verifyStreamThreadIdentity(
  path: string,
  expectedThreadId: string,
  frame: StreamFrame,
  frameSha256: string,
): void {
  if (frame.type === "event") {
    if (frame.event.threadId === expectedThreadId) return;
    throw new NapierStreamThreadIdentityError(path, {
      frameType: frame.type,
      expectedThreadId,
      actualThreadId: frame.event.threadId,
      frameSha256,
    });
  }
  if (frame.type === "snapshot") {
    if (frame.detail.thread.id === expectedThreadId) return;
    throw new NapierStreamThreadIdentityError(path, {
      frameType: frame.type,
      expectedThreadId,
      actualThreadId: frame.detail.thread.id,
      frameSha256,
    });
  }
  if (frame.type === "done") {
    if (frame.threadId === expectedThreadId) return;
    throw new NapierStreamThreadIdentityError(path, {
      frameType: frame.type,
      expectedThreadId,
      actualThreadId: frame.threadId,
      frameSha256,
    });
  }
  if (frame.type === "error") {
    if (frame.threadId === expectedThreadId) return;
    throw new NapierStreamThreadIdentityError(path, {
      frameType: frame.type,
      expectedThreadId,
      actualThreadId: frame.threadId,
      frameSha256,
    });
  }
}

function verifyStreamRunIdentity(
  path: string,
  expectedRunId: string | undefined,
  frame: StreamFrame,
  frameSha256: string,
): string | undefined {
  const actualRunId =
    frame.type === "event"
      ? frame.event.runId
      : frame.type === "done"
        ? frame.runId
        : undefined;
  if (!actualRunId) return expectedRunId;
  if (!expectedRunId) return actualRunId;
  if (actualRunId === expectedRunId) return expectedRunId;
  throw new NapierStreamRunIdentityError(path, {
    frameType: frame.type,
    expectedRunId,
    actualRunId,
    frameSha256,
  });
}

async function verifyStreamRunResponseContract(
  path: string,
  response: Response,
  expectation: StreamRunExpectation,
): Promise<void> {
  expectHeaderIncludes(path, response, "content-type", "text/event-stream");
  expectHeader(path, response, "cache-control", "no-cache");
  expectHeader(path, response, "x-napier-thread-id", expectation.threadId);
  expectHeader(
    path,
    response,
    expectation.kind === "prompt"
      ? "x-napier-prompt-requested"
      : "x-napier-resume-requested",
    "true",
  );
  if (expectation.kind === "resume") {
    expectOptionalHeader(path, response, "x-napier-run-id", expectation.runId);
  }
  expectOptionalHeader(
    path,
    response,
    "x-napier-model-provider",
    expectation.model?.provider,
  );
  expectOptionalHeader(
    path,
    response,
    "x-napier-model-id",
    expectation.model?.id,
  );
  expectHeader(
    path,
    response,
    "x-napier-stream-error-code",
    RUN_STREAM_ERROR_CODE,
  );
  expectHeader(path, response, "x-napier-stream-error-diagnostic", "sha256");
  expectHeader(
    path,
    response,
    "x-napier-stream-error-message-sha256",
    await sha256Text(RUN_STREAM_ERROR_MESSAGE),
  );
}

function expectHeader(
  path: string,
  response: Response,
  header: string,
  expected: string,
): void {
  const actual = response.headers.get(header) ?? undefined;
  if (actual !== expected) {
    throw new NapierStreamResponseContractError(path, {
      status: response.status,
      header,
      expected,
      ...(actual !== undefined ? { actual } : {}),
    });
  }
}

function expectOptionalHeader(
  path: string,
  response: Response,
  header: string,
  expected: string | undefined,
): void {
  if (expected === undefined) {
    const actual = response.headers.get(header) ?? undefined;
    if (actual !== undefined) {
      throw new NapierStreamResponseContractError(path, {
        status: response.status,
        header,
        expected: "absent",
        actual,
      });
    }
    return;
  }
  expectHeader(path, response, header, expected);
}

function expectHeaderIncludes(
  path: string,
  response: Response,
  header: string,
  expected: string,
): void {
  const actual = response.headers.get(header) ?? undefined;
  if (!actual?.toLowerCase().includes(expected)) {
    throw new NapierStreamResponseContractError(path, {
      status: response.status,
      header,
      expected,
      ...(actual !== undefined ? { actual } : {}),
    });
  }
}

async function parseStreamFrameRecord(
  path: string,
  record: string,
): Promise<ParsedStreamFrame | undefined> {
  const lines = record.split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return undefined;
  const frameSha256 = await sha256Text(data);
  const lineCount = data.split(/\r?\n/).length;
  const eventType = lines
    .filter((line) => line.startsWith("event:"))
    .map((line) => line.slice(6).trimStart())
    .at(-1);
  const sseId = lines
    .filter((line) => line.startsWith("id:"))
    .map((line) => line.slice(3).trimStart())
    .at(-1);
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    throw new NapierStreamFrameParseError(path, {
      frameSha256,
      lineCount,
    });
  }
  if (!isStreamFrame(frame)) {
    const contractReason = streamFrameContractReason(frame) ?? "not_object";
    throw new NapierStreamFrameContractError(path, {
      frameSha256,
      lineCount,
      reason: contractReason,
    });
  }
  if (eventType && eventType !== frame.type) {
    throw new NapierStreamFrameEventTypeError(path, {
      eventType,
      frameType: frame.type,
      frameSha256,
    });
  }
  await verifyStreamEventHash(path, frame, frameSha256);
  await verifyStreamSnapshotHash(path, frame, frameSha256);
  verifyStreamFrameId(path, frame, sseId, frameSha256);
  return { frame, frameSha256 };
}

async function verifyStreamEventHash(
  path: string,
  frame: StreamFrame,
  frameSha256: string,
): Promise<void> {
  if (frame.type !== "event") return;
  const actualSha256 = await sha256Text(JSON.stringify(frame.event));
  if (actualSha256 === frame.eventSha256) return;
  throw new NapierStreamEventHashError(path, {
    expectedSha256: frame.eventSha256,
    actualSha256,
    frameSha256,
  });
}

async function verifyStreamSnapshotHash(
  path: string,
  frame: StreamFrame,
  frameSha256: string,
): Promise<void> {
  if (frame.type !== "snapshot") return;
  const actualSha256 = await sha256Text(JSON.stringify(frame.detail));
  if (actualSha256 === frame.detailSha256) return;
  throw new NapierStreamSnapshotHashError(path, {
    expectedSha256: frame.detailSha256,
    actualSha256,
    frameSha256,
  });
}

function verifyStreamFrameId(
  path: string,
  frame: StreamFrame,
  sseId: string | undefined,
  frameSha256: string,
): void {
  const expectedId =
    frame.type === "event" ? String(frame.event.seq) : "absent";
  if (frame.type === "event") {
    if (sseId === expectedId) return;
    throw new NapierStreamFrameIdError(path, {
      frameType: frame.type,
      expectedId,
      ...(sseId !== undefined ? { actualId: sseId } : {}),
      frameSha256,
    });
  }
  if (sseId !== undefined) {
    throw new NapierStreamFrameIdError(path, {
      frameType: frame.type,
      expectedId,
      actualId: sseId,
      frameSha256,
    });
  }
}

function isStreamFrame(frame: unknown): frame is StreamFrame {
  return streamFrameContractReason(frame) === undefined;
}

function streamFrameContractReason(
  frame: unknown,
): NapierStreamFrameContractReason | undefined {
  if (!isRecord(frame)) return "not_object";
  const type = frame["type"];
  if (typeof type !== "string") return "missing_type";
  switch (type) {
    case "event":
      return isRunEventFrame(frame) ? undefined : "invalid_event";
    case "snapshot":
      return isSnapshotFrame(frame) ? undefined : "invalid_snapshot";
    case "error":
      return isErrorFrame(frame) ? undefined : "invalid_error_message";
    case "done":
      return typeof frame["threadId"] === "string" &&
        typeof frame["runId"] === "string" &&
        typeof frame["status"] === "string" &&
        TERMINAL_RUN_STATUSES.has(frame["status"]) &&
        typeof frame["snapshotSha256"] === "string" &&
        SHA256.test(frame["snapshotSha256"]) &&
        typeof frame["eventCount"] === "number" &&
        Number.isSafeInteger(frame["eventCount"]) &&
        frame["eventCount"] >= 0 &&
        typeof frame["eventStreamSha256"] === "string" &&
        SHA256.test(frame["eventStreamSha256"])
        ? undefined
        : "invalid_done";
    default:
      return "unsupported_type";
  }
}

function isRunEventFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["eventSha256"] === "string" &&
    SHA256.test(frame["eventSha256"]) &&
    isRunEventRecord(frame["event"])
  );
}

function isRunEventRecord(event: unknown): boolean {
  return (
    isRecord(event) &&
    typeof event["id"] === "string" &&
    typeof event["threadId"] === "string" &&
    typeof event["runId"] === "string" &&
    typeof event["seq"] === "number" &&
    Number.isSafeInteger(event["seq"]) &&
    event["seq"] > 0 &&
    typeof event["type"] === "string" &&
    typeof event["category"] === "string" &&
    EVENT_CATEGORIES.has(event["category"] as EventCategory) &&
    typeof event["visibility"] === "string" &&
    EVENT_VISIBILITIES.has(event["visibility"] as EventVisibility) &&
    typeof event["createdAt"] === "string" &&
    Object.prototype.hasOwnProperty.call(event, "payload")
  );
}

function isSnapshotFrame(frame: Record<string, unknown>): boolean {
  if (
    typeof frame["detailSha256"] !== "string" ||
    !SHA256.test(frame["detailSha256"])
  ) {
    return false;
  }
  const detail = frame["detail"];
  if (!isRecord(detail) || !isRecord(detail["thread"])) return false;
  const thread = detail["thread"];
  const threadId = thread["id"];
  if (typeof threadId !== "string") return false;
  if (
    typeof thread["title"] !== "string" ||
    typeof thread["agentId"] !== "string" ||
    typeof thread["createdAt"] !== "string" ||
    typeof thread["updatedAt"] !== "string" ||
    typeof thread["lastMessage"] !== "string" ||
    !Array.isArray(thread["runIds"]) ||
    !thread["runIds"].every((runId) => typeof runId === "string")
  ) {
    return false;
  }
  const threadStatus = thread["status"];
  if (
    typeof threadStatus !== "string" ||
    !THREAD_STATUSES.has(threadStatus as ThreadStatus)
  ) {
    return false;
  }
  const eventCount = thread["eventCount"];
  if (
    typeof eventCount !== "number" ||
    !Number.isSafeInteger(eventCount) ||
    eventCount < 0
  ) {
    return false;
  }
  const events = detail["events"];
  if (!Array.isArray(events)) return false;
  if (events.length !== eventCount) return false;
  if (!isRecord(detail["agent"]) || typeof detail["agent"]["id"] !== "string") {
    return false;
  }
  if (detail["agent"]["id"] !== thread["agentId"]) return false;
  if (!isRecord(detail["contextCheckpointCalibration"])) return false;
  for (const field of THREAD_DETAIL_ARRAY_FIELDS) {
    if (!Array.isArray(detail[field])) return false;
  }
  const runs = detail["runs"];
  if (!Array.isArray(runs)) return false;
  const threadRunIds = thread["runIds"];
  if (!Array.isArray(threadRunIds)) return false;
  if (threadRunIds.length !== runs.length) return false;
  const runIds = new Set<string>();
  for (const run of runs) {
    if (!isRunRecordForThread(run, threadId, thread["agentId"])) return false;
    if (!isRecord(run)) return false;
    const runId = run["id"];
    if (typeof runId !== "string" || runIds.has(runId)) return false;
    runIds.add(runId);
  }
  for (const runId of threadRunIds) {
    if (typeof runId !== "string" || !runIds.has(runId)) return false;
  }
  const currentRunId = thread["currentRunId"];
  if (currentRunId !== undefined) {
    if (typeof currentRunId !== "string" || !runIds.has(currentRunId)) {
      return false;
    }
  }
  let lastSeq = 0;
  for (const [index, event] of events.entries()) {
    if (!isRunEventRecord(event)) return false;
    if (!isRecord(event)) return false;
    if (event["threadId"] !== threadId) return false;
    const seq = event["seq"];
    if (typeof seq !== "number" || seq <= lastSeq || seq !== index + 1) {
      return false;
    }
    lastSeq = seq;
  }
  return true;
}

function isRunRecordForThread(
  run: unknown,
  threadId: string,
  agentId: unknown,
): boolean {
  return (
    isRecord(run) &&
    typeof agentId === "string" &&
    typeof run["id"] === "string" &&
    run["threadId"] === threadId &&
    run["agentId"] === agentId &&
    typeof run["status"] === "string" &&
    (TERMINAL_RUN_STATUSES.has(run["status"]) ||
      run["status"] === "queued" ||
      run["status"] === "running") &&
    typeof run["startedAt"] === "string"
  );
}

function isErrorFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame["threadId"] === "string" &&
    typeof frame["message"] === "string" &&
    frame["code"] === "run_failed" &&
    typeof frame["diagnosticSha256"] === "string" &&
    SHA256.test(frame["diagnosticSha256"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
