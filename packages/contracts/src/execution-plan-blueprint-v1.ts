import type { ModelRef } from "./execution-core.js";
import type { ExecutionPlan } from "./execution-plan-v1.js";
import type { ExecutionPlanBlueprint, ExecutionPlanStatus } from "./execution-workflows.js";
import type { ModelContextEnvelopeReceipt } from "./model-context-envelope.js";

export type ExecutionPlanBlueprintRecordStatus = "active" | "archived";

export interface ExecutionPlanBlueprintRecord {
  id: string;
  name: string;
  description: string;
  status: ExecutionPlanBlueprintRecordStatus;
  blueprint: ExecutionPlanBlueprint;
  blueprintSha256: string;
  sourceThreadId: string;
  sourcePlanId: string;
  sourcePlanRevision: number;
  sourcePlanArchiveSha256: string;
  sourceEventStreamSha256: string;
  createdByThreadId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface SaveExecutionPlanBlueprintRequest {
  blueprint: ExecutionPlanBlueprint;
  name?: string;
  description?: string;
}

export interface SaveExecutionPlanBlueprintResult {
  record: ExecutionPlanBlueprintRecord;
  created: boolean;
}

export interface SetExecutionPlanBlueprintRecordStatusRequest {
  status: ExecutionPlanBlueprintRecordStatus;
}

export type ExecutionPlanBlueprintRecordQualificationStatus = "qualified" | "archived" | "source_missing" | "source_drift" | "invalid";

export interface ExecutionPlanBlueprintRecordQualification {
  status: ExecutionPlanBlueprintRecordQualificationStatus;
  diagnostics: string[];
  recordId: string;
  recordStatus?: ExecutionPlanBlueprintRecordStatus;
  blueprintSha256?: string;
  sourceThreadId?: string;
  sourcePlanId?: string;
  sourcePlanRevision?: number;
  expectedPlanArchiveSha256?: string;
  expectedEventStreamSha256?: string;
  actualSourcePlanRevision?: number;
  actualPlanArchiveSha256?: string;
  actualEventStreamSha256?: string;
  stepCount: number;
  artifactCount: number;
  qualifiedAt: string;
}

export type ExecutionPlanBlueprintRecordPreviewStatus = "ready" | "not_qualified" | "blocked";

export interface ExecutionPlanBlueprintRecordPreview {
  status: ExecutionPlanBlueprintRecordPreviewStatus;
  diagnostics: string[];
  threadId: string;
  recordId: string;
  qualification: ExecutionPlanBlueprintRecordQualification;
  hasOpenPlan: boolean;
  plan?: ExecutionPlan;
  previewSha256: string;
}

export interface ExecutionPlanBlueprintRecordReplay {
  eventId: string;
  threadId: string;
  runId: string;
  seq: number;
  createdAt: string;
  recordId: string;
  planId: string;
  objectiveSha256: string;
  status: ExecutionPlanStatus;
  stepCount: number;
  artifactCount: number;
  blueprintSha256: string;
  sourcePlanId: string;
  sourcePlanRevision: number;
  sourcePlanArchiveSha256: string;
  qualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  qualificationSha256: string;
  qualificationDiagnosticsSha256: string;
  previewSha256: string;
}

export interface ExecutionPlanBlueprintRecordReplayHistory {
  kind: "napier.execution-plan-blueprint-replay-history";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordId: string;
  replayCount: number;
  threadCount: number;
  planCount: number;
  eventSetSha256: string;
  firstSeq?: number;
  lastSeq?: number;
  replays: ExecutionPlanBlueprintRecordReplay[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecordReplayOutcomeStatus = ExecutionPlanStatus | "plan_missing" | "identity_mismatch";

export interface ExecutionPlanBlueprintRecordReplayOutcome {
  replayEventId: string;
  replayEventSeq: number;
  threadId: string;
  planId: string;
  createdAt: string;
  status: ExecutionPlanBlueprintRecordReplayOutcomeStatus;
  planRevision?: number;
  stepCount: number;
  completedStepCount: number;
  skippedStepCount: number;
  blockedStepCount: number;
  artifactCount: number;
  verifiedArtifactCount: number;
  missingArtifactCount: number;
  replanCount: number;
  planProjectionSha256?: string;
  outcomeSha256: string;
}

export interface ExecutionPlanBlueprintRecordReplayOutcomes {
  kind: "napier.execution-plan-blueprint-replay-outcomes";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordId: string;
  replayHistorySha256: string;
  replayCount: number;
  activeCount: number;
  completedCount: number;
  blockedCount: number;
  cancelledCount: number;
  invalidCount: number;
  completionRateBps: number;
  outcomeSetSha256: string;
  outcomes: ExecutionPlanBlueprintRecordReplayOutcome[];
  contentSha256: string;
}

export interface VerifyExecutionPlanBlueprintRecordReplayHistoryRequest {
  history: unknown;
}

export interface VerifyExecutionPlanBlueprintRecordReplayOutcomesRequest {
  outcomes: unknown;
}

export interface VerifyExecutionPlanBlueprintRecordReplayEventRequest {
  threadId: string;
  eventId: string;
  seq: number;
  eventSha256: string;
}

export type ExecutionPlanBlueprintRecordReplayHistoryVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintRecordReplayHistoryVerification {
  schemaVersion: 1;
  status: ExecutionPlanBlueprintRecordReplayHistoryVerificationStatus;
  diagnostics: string[];
  recordId?: string;
  expectedRecordId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  observedContentSha256?: string;
  declaredEventSetSha256?: string;
  observedEventSetSha256?: string;
  replayCount?: number;
  observedReplayCount?: number;
  threadCount?: number;
  observedThreadCount?: number;
  planCount?: number;
  observedPlanCount?: number;
  firstSeq?: number;
  observedFirstSeq?: number;
  lastSeq?: number;
  observedLastSeq?: number;
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecordReplayOutcomesVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintRecordReplayOutcomesVerification {
  schemaVersion: 1;
  status: ExecutionPlanBlueprintRecordReplayOutcomesVerificationStatus;
  diagnostics: string[];
  recordId?: string;
  expectedRecordId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  observedContentSha256?: string;
  declaredReplayHistorySha256?: string;
  observedReplayHistorySha256?: string;
  declaredOutcomeSetSha256?: string;
  observedOutcomeSetSha256?: string;
  replayCount?: number;
  observedReplayCount?: number;
  completedCount?: number;
  observedCompletedCount?: number;
  blockedCount?: number;
  observedBlockedCount?: number;
  invalidCount?: number;
  observedInvalidCount?: number;
  contentSha256: string;
}

export interface ExecutionPlanBlueprintRecordOutcomeBaselinePolicy {
  minReplayCount: number;
  minCompletionRateBps: number;
  maxBlockedCount: number;
  maxInvalidCount: number;
}

export interface ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate {
  minScore: number;
  maxRisk: ExecutionPlanBlueprintOutcomeReviewRisk;
}

export interface ExecutionPlanBlueprintRecordOutcomeBaseline {
  id: string;
  recordId: string;
  replayOutcomesSha256: string;
  replayHistorySha256: string;
  outcomeSetSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy;
  reviewGate?: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate;
  reviewSha256?: string;
  reviewInputSha256?: string;
  reviewResponseSha256?: string;
  reviewVerdict?: ExecutionPlanBlueprintOutcomeReviewVerdict;
  reviewScore?: number;
  reviewRisk?: ExecutionPlanBlueprintOutcomeReviewRisk;
  reviewModel?: ModelRef;
  promotedAt: string;
  supersedesBaselineId?: string;
  contentSha256: string;
}

export interface PromoteExecutionPlanBlueprintRecordOutcomeBaselineRequest {
  outcomes: unknown;
  policy?: Partial<ExecutionPlanBlueprintRecordOutcomeBaselinePolicy>;
  review?: unknown;
  reviewGate?: Partial<ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate>;
}

export interface PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult {
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline;
  created: boolean;
}

export type ExecutionPlanBlueprintRecordOutcomeQualificationStatus = "qualified" | "missing_baseline" | "policy_failed";

export interface ExecutionPlanBlueprintRecordOutcomeQualification {
  schemaVersion: 1;
  status: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  diagnostics: string[];
  recordId: string;
  baselineId?: string;
  baselineSha256?: string;
  baselineOutcomesSha256?: string;
  currentOutcomesSha256: string;
  currentReplayHistorySha256: string;
  currentOutcomeSetSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  policy?: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy;
  contentSha256: string;
}

export interface ExecutionPlanBlueprintOutcomeReviewCriterion {
  id: string;
  name: string;
  description: string;
}

export interface ExecutionPlanBlueprintOutcomeReviewCriteria {
  name: string;
  criteria: ExecutionPlanBlueprintOutcomeReviewCriterion[];
}

export type ExecutionPlanBlueprintOutcomeReviewVerdict = "promote" | "revise" | "reject" | "inconclusive";

export type ExecutionPlanBlueprintOutcomeReviewRisk = "low" | "medium" | "high";

export interface ExecutionPlanBlueprintOutcomeReviewScore {
  criterionId: string;
  score: number;
  reason: string;
}

export interface ReviewExecutionPlanBlueprintRecordOutcomesRequest {
  model: ModelRef;
  criteria?: ExecutionPlanBlueprintOutcomeReviewCriteria;
}

export interface ExecutionPlanBlueprintRecordOutcomeReview {
  kind: "napier.execution-plan-blueprint-outcome-review";
  schemaVersion: 1;
  policyId: string;
  recordId: string;
  blueprintSha256: string;
  model: ModelRef;
  criteria: ExecutionPlanBlueprintOutcomeReviewCriteria;
  verdict: ExecutionPlanBlueprintOutcomeReviewVerdict;
  score: number;
  risk: ExecutionPlanBlueprintOutcomeReviewRisk;
  reason: string;
  concerns: string[];
  scores: ExecutionPlanBlueprintOutcomeReviewScore[];
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  replayOutcomesSha256: string;
  replayHistorySha256: string;
  outcomeSetSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  baselineId?: string;
  baselineSha256?: string;
  baselineOutcomesSha256?: string;
  inputSha256: string;
  promptSha256: string;
  responseSha256: string;
  reviewSchemaSha256: string;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
  reviewSha256: string;
  createdAt: string;
}
