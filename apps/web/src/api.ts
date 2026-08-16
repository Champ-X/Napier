import type {
  AnswerOperatorDecisionRequest,
  ApplyExtensionPackageDeploymentRequest,
  ApplyExtensionPackageDeploymentResult,
  ApplyExtensionPackageRolloutChannelRequest,
  ApplyExtensionPackageRolloutChannelResult,
  ApplyExtensionPackageUpdateRequest,
  ApplyExtensionPackageUpdateResult,
  CreateBranchRequest,
  ContextCheckpointCalibrationReport,
  CreateExecutionPlanFromBlueprintRequest,
  CreateExecutionPlanFromBlueprintRecordRequest,
  CreateEvaluationSuiteRequest,
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
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  ExecutionPlanBlueprintVerification,
  HealthResponse,
  ImportThreadReplayBundleRequest,
  ImportSignedExtensionPackageRequest,
  MemoryFact,
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
  OperatorDecision,
  PreviewExtensionPackageDeploymentRequest,
  PublishExtensionPackageRolloutChannelRequest,
  PreviewExtensionPackageUpdateRequest,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest,
  QueueRunControlMessageRequest,
  ReplanExecutionPlanRequest,
  ReviewExtensionRequest,
  ReviewExecutionPlanBlueprintRecordOutcomesRequest,
  ReviewExecutionPlanReplanDraftRequest,
  ReviewMemoryRequest,
  ReviewMcpToolRequest,
  ReviewRunEvaluationRequest,
  ResolveEvaluationConsensusRequest,
  ResolveEvaluationConsensusResult,
  RunComparison,
  RunControlMessage,
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
  SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
  SubmitEvaluationReviewerBallotRequest,
  ThreadDetail,
  ThreadReplayBundle,
  UpdateArtifactManifestRequest,
  UpdateEvaluationSuiteRequest,
  UsagePriceTableCatalog,
  UsagePriceTableVerification,
  VerifyUsagePriceTableCatalogRequest,
  ExtensionPackageChannelIndexVerification,
  VerifyExtensionPackageLockfileRequest,
  VerifyExtensionPackageChannelIndexRequest,
  VerifyExecutionPlanBlueprintRequest,
  VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest,
  VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
  VerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
  VerifyExecutionPlanArchiveRequest,
  VerifyOpenTelemetryTraceArtifactRequest,
  VerifySignedExtensionPackageRequest,
  VerifyRunReplaySnapshotRequest,
  VerifyThreadReplayBundleRequest,
  ThreadReplayBundleVerification,
  TrustedReceiptEnvelope,
} from "@napier/contracts";
import { requestJson, requestJsonWithResponse } from "./api-client";
export { validateStreamFrameRecord } from "./stream-frame-validation";

export interface ThreadDetailImportReceipt {
  seq: number;
  payloadSha256: string;
}

export type WebThreadDetail = ThreadDetail & {
  importReceipt?: ThreadDetailImportReceipt;
};

export interface CreatedExecutionPlanFromBlueprintRecord {
  plan: ExecutionPlan;
  replayEvent?: VerifyExecutionPlanBlueprintRecordReplayEventRequest;
}
const SHA256 = /^[a-f0-9]{64}$/;

export function getHealth(): Promise<HealthResponse> {
  return requestJson("/api/health");
}

async function requestThreadDetail(
  path: string,
  init?: RequestInit,
): Promise<WebThreadDetail> {
  const { body, headers } = await requestJsonWithResponse<ThreadDetail>(
    path,
    init,
  );
  const importReceipt = importReceiptFromHeaders(headers);
  return importReceipt ? { ...body, importReceipt } : body;
}

function importReceiptFromHeaders(
  headers: Headers,
): ThreadDetailImportReceipt | undefined {
  const seq = Number(headers.get("x-napier-import-receipt-seq"));
  const payloadSha256 = headers.get("x-napier-import-receipt-sha256");
  if (
    !Number.isSafeInteger(seq) ||
    seq < 1 ||
    !payloadSha256 ||
    !SHA256.test(payloadSha256)
  ) {
    return undefined;
  }
  return { seq, payloadSha256 };
}

export function getThread(threadId: string): Promise<WebThreadDetail> {
  return requestThreadDetail(`/api/threads/${encodeURIComponent(threadId)}`);
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
): Promise<WebThreadDetail> {
  return requestThreadDetail("/api/threads/import", {
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

export function updatePlanArtifact(
  threadId: string,
  planId: string,
  artifactId: string,
  body: UpdateArtifactManifestRequest,
): Promise<ExecutionPlan> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/plans/${encodeURIComponent(planId)}/artifacts/${encodeURIComponent(artifactId)}`,
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

export function verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
  body: VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
): Promise<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function signExecutionPlanBlueprintRecommendationPolicyOverrideRetirementProofBundle(
  body: SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest,
): Promise<
  TrustedReceiptEnvelope<ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle>
> {
  return requestJson(
    "/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign",
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
): Promise<WebThreadDetail> {
  return requestThreadDetail("/api/threads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function setGoal(
  threadId: string,
  body: SetGoalRequest,
): Promise<WebThreadDetail> {
  return requestThreadDetail(
    `/api/threads/${encodeURIComponent(threadId)}/goal`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export function clearGoal(threadId: string): Promise<WebThreadDetail> {
  return requestThreadDetail(
    `/api/threads/${encodeURIComponent(threadId)}/goal`,
    {
      method: "DELETE",
    },
  );
}

export function createBranch(
  threadId: string,
  body: CreateBranchRequest,
): Promise<WebThreadDetail> {
  return requestThreadDetail(
    `/api/threads/${encodeURIComponent(threadId)}/branches`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function stopRun(threadId: string): Promise<{ stopped: boolean }> {
  return requestJson(`/api/threads/${encodeURIComponent(threadId)}/stop`, {
    method: "POST",
  });
}

export function queueRunControlMessage(
  threadId: string,
  runId: string,
  body: QueueRunControlMessageRequest,
): Promise<RunControlMessage> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/control-messages`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function cancelRunControlMessage(
  threadId: string,
  runId: string,
  controlMessageId: string,
): Promise<RunControlMessage> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/control-messages/${encodeURIComponent(controlMessageId)}/cancel`,
    { method: "POST" },
  );
}

export function answerOperatorDecision(
  threadId: string,
  decisionId: string,
  body: AnswerOperatorDecisionRequest,
): Promise<OperatorDecision> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/operator-decisions/${encodeURIComponent(decisionId)}/answer`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export function cancelOperatorDecision(
  threadId: string,
  decisionId: string,
): Promise<OperatorDecision> {
  return requestJson(
    `/api/threads/${encodeURIComponent(threadId)}/operator-decisions/${encodeURIComponent(decisionId)}/cancel`,
    { method: "POST" },
  );
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

export {
  continueOperatorDecision,
  resumeInterruptedRun,
  streamPrompt,
} from "./thread-run-api";
