export const NAPIER_API_VERSION = "2026-07-25";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ThreadStatus = "idle" | "running" | "waiting" | "failed";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type TerminalRunStatus = Exclude<RunStatus, "queued" | "running">;
export type RunInvocationSource = "user" | "recovery" | "schedule" | "channel";
export type GoalStatus = "active" | "completed" | "blocked";
export type GoalBlocker =
  | "none"
  | "missing_evidence"
  | "needs_user_input"
  | "run_failed"
  | "external_wait"
  | "goal_not_met_yet";

export type EventCategory =
  | "lifecycle"
  | "message"
  | "model"
  | "tool"
  | "artifact"
  | "goal"
  | "plan"
  | "memory"
  | "subagent"
  | "extension"
  | "credential"
  | "evaluation"
  | "automation"
  | "channel"
  | "system";

export type EventVisibility = "user" | "debug" | "hidden";

export interface Usage extends Record<string, JsonPrimitive> {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export type UsageAccountingStrategy =
  | "demo_estimate"
  | "provider_reported"
  | "openai_cache_discounted"
  | "anthropic_cache_discounted"
  | "google_cache_discounted";
export type UsageCostAccountingStrategy =
  | "zero_cost"
  | "provider_reported_cost"
  | "price_table_estimate";

export interface UsageAccounting extends Record<string, JsonPrimitive> {
  schemaVersion: 1;
  model: string;
  strategy: UsageAccountingStrategy;
  rawTotalTokens: number;
  budgetTokens: number;
  reportedCostUsd: number;
  estimatedCostUsd: number;
  budgetCostUsd: number;
  costStrategy: UsageCostAccountingStrategy;
  priceTableId: string;
  priceTableSha256: string;
  inputWeight: number;
  outputWeight: number;
  cacheReadWeight: number;
  cacheWriteWeight: number;
  contentSha256: string;
}

export interface UsagePriceTable {
  schemaVersion: 1;
  id: string;
  provider: string;
  label: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  effectiveAt: string;
  source: string;
  tableSha256: string;
}

export interface UsagePriceTableCatalog {
  kind: "napier.usage-price-table-catalog";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  tables: UsagePriceTable[];
  contentSha256: string;
}

export type UsagePriceTableVerificationStatus =
  | "valid"
  | "invalid"
  | "provider_missing";

export interface UsagePriceTableVerification {
  status: UsagePriceTableVerificationStatus;
  catalogSha256?: string;
  tableCount: number;
  providers: string[];
  diagnostics: string[];
}

export interface VerifyUsagePriceTableCatalogRequest {
  catalog: UsagePriceTableCatalog;
  requiredProviders?: string[];
}

export interface RunEvent<TPayload extends JsonValue = JsonValue> {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  type: string;
  category: EventCategory;
  visibility: EventVisibility;
  createdAt: string;
  payload: TPayload;
}

export interface TextMessagePayload {
  role: "user" | "assistant" | "system";
  text: string;
  reasoning?: string;
  model?: string;
  usage?: Usage;
}

export interface ToolEventPayload {
  callId: string;
  toolName: string;
  status: "started" | "progress" | "completed" | "failed" | "blocked";
  effect?: McpToolEffect;
  input?: JsonValue;
  output?: string;
  durationMs?: number;
  policyReason?: string;
}

export interface GoalState {
  objective: string;
  status: GoalStatus;
  blocker: GoalBlocker;
  reason: string;
  evidence: string;
  continuationCount: number;
  maxContinuations: number;
  noProgressCount: number;
  maxNoProgressContinuations: number;
  lastEvidenceHash?: string;
  lastEvaluatedRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoalEvaluation {
  satisfied: boolean;
  blocker: GoalBlocker;
  reason: string;
  evidence: string;
}

export type ExecutionPlanStatus =
  | "active"
  | "completed"
  | "blocked"
  | "cancelled";
export type PlanStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "blocked"
  | "skipped";
export type ArtifactManifestStatus =
  | "expected"
  | "produced"
  | "verified"
  | "missing"
  | "superseded";
export type ExecutionPlanReplanStrategy =
  | "recover_blocked"
  | "scope_change"
  | "artifact_drift";

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  verification: string;
  dependsOn: string[];
  status: PlanStepStatus;
  evidence: string;
  blocker?: string;
  runId?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactManifestEntry {
  id: string;
  path: string;
  kind: "file" | "directory" | "url" | "other";
  description: string;
  status: ArtifactManifestStatus;
  sha256?: string;
  sizeBytes?: number;
  sourceRunId?: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionPlanReplanRecord {
  id: string;
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  supersededStepIds: string[];
  supersededArtifactIds: string[];
  dependencyUpdatedStepIds: string[];
  addedStepIds: string[];
  addedArtifactIds: string[];
  addedStepsSha256: string;
  addedArtifactsSha256: string;
  dependencyUpdatesSha256: string;
  fromRevision: number;
  toRevision: number;
  replanSha256: string;
  createdAt: string;
}

export type ExecutionPlanReplanPolicyPosture =
  | "conservative"
  | "balanced"
  | "expansive";

export type ExecutionPlanReplanDraftEvaluationRisk = "low" | "medium" | "high";

export type ExecutionPlanReplanDraftEvaluationSeverity =
  | "info"
  | "warning"
  | "blocking";

export interface ExecutionPlanReplanDraftEvaluationCheck {
  id: string;
  severity: ExecutionPlanReplanDraftEvaluationSeverity;
  passed: boolean;
  detail: string;
}

export interface ExecutionPlanReplanDraftEvaluation {
  policyId: string;
  posture: ExecutionPlanReplanPolicyPosture;
  score: number;
  risk: ExecutionPlanReplanDraftEvaluationRisk;
  maxDraftSteps: number;
  addStepCount: number;
  addArtifactCount: number;
  dependencyUpdateCount: number;
  supersedeStepCount: number;
  supersedeArtifactCount: number;
  checks: ExecutionPlanReplanDraftEvaluationCheck[];
  evaluationSha256: string;
}

export type ExecutionPlanReplanDraftReviewVerdict =
  | "approve"
  | "revise"
  | "reject"
  | "inconclusive";

export interface ExecutionPlanReplanDraftModelReview {
  kind: "napier.execution-plan-replan-draft-review";
  schemaVersion: 1;
  policyId: string;
  planId: string;
  threadId: string;
  expectedRevision: number;
  recommendationSha256: string;
  draftSha256: string;
  deterministicEvaluationSha256: string;
  model: ModelRef;
  verdict: ExecutionPlanReplanDraftReviewVerdict;
  score: number;
  risk: ExecutionPlanReplanDraftEvaluationRisk;
  reason: string;
  concerns: string[];
  inputSha256: string;
  promptSha256: string;
  responseSha256: string;
  reviewSchemaSha256: string;
  reviewSha256: string;
  createdAt: string;
}

export interface ExecutionPlanReplanDraft {
  policyId: string;
  request: ReplanExecutionPlanRequest;
  draftSha256: string;
  evaluation: ExecutionPlanReplanDraftEvaluation;
}

export interface ExecutionPlanReplanPolicyTemplate {
  id: string;
  label: string;
  model: ModelRef;
  thinkingLevel: AgentProfile["thinkingLevel"];
  posture: ExecutionPlanReplanPolicyPosture;
  maxDraftSteps: number;
  checklist: string[];
  instruction: string;
  templateSha256: string;
}

export interface ExecutionPlanReplanRecommendation {
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  expectedRevision: number;
  supersedeStepIds: string[];
  supersedeArtifactIds: string[];
  affectedStepIds: string[];
  affectedArtifactIds: string[];
  draft: ExecutionPlanReplanDraft;
  recommendationSha256: string;
}

export interface ExecutionPlan {
  id: string;
  threadId: string;
  objective: string;
  status: ExecutionPlanStatus;
  steps: PlanStep[];
  artifacts: ArtifactManifestEntry[];
  replans: ExecutionPlanReplanRecord[];
  replanRecommendation: ExecutionPlanReplanRecommendation | null;
  criticalPathStepIds: string[];
  readyStepIds: string[];
  blockedStepIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExecutionPlanRequest {
  objective: string;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    verification: string;
    dependsOn?: string[];
  }>;
  artifacts?: Array<{
    id: string;
    path: string;
    kind?: ArtifactManifestEntry["kind"];
    description: string;
  }>;
}

export interface ReplanExecutionPlanRequest {
  expectedRevision: number;
  strategy: ExecutionPlanReplanStrategy;
  reason: string;
  evidence: string;
  supersedeStepIds?: string[];
  supersedeArtifactIds?: string[];
  dependencyUpdates?: Array<{
    stepId: string;
    dependsOn: string[];
  }>;
  addSteps?: CreateExecutionPlanRequest["steps"];
  addArtifacts?: CreateExecutionPlanRequest["artifacts"];
}

export interface ReviewExecutionPlanReplanDraftRequest {
  model?: ModelRef;
}

export interface TransitionPlanStepRequest {
  action: "start" | "complete" | "block" | "skip" | "reopen";
  runId?: string;
  evidence?: string;
  blocker?: string;
}

export interface UpdateArtifactManifestRequest {
  status: ArtifactManifestStatus;
  sha256?: string;
  sizeBytes?: number;
  sourceRunId?: string;
  evidence?: string;
  observeWorkspace?: boolean;
}

export interface ExecutionPlanArchive {
  kind: "napier.execution-plan-archive";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  plan: ExecutionPlan;
  events: RunEvent[];
  eventStreamSha256: string;
  contentSha256: string;
}

export interface VerifyExecutionPlanArchiveRequest {
  archive: ExecutionPlanArchive;
}

export type ExecutionPlanArchiveVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanArchiveVerification {
  status: ExecutionPlanArchiveVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  stepCount: number;
  artifactCount: number;
  replanCount: number;
  threadId?: string;
  planId?: string;
  revision?: number;
  contentSha256?: string;
  eventStreamSha256?: string;
}

export interface ExecutionPlanBlueprintSource {
  type: "plan";
  threadId: string;
  planId: string;
  planRevision: number;
  planArchiveSha256: string;
  eventStreamSha256: string;
}

export interface ExecutionPlanBlueprint {
  kind: "napier.execution-plan-blueprint";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  title: string;
  objective: string;
  source: ExecutionPlanBlueprintSource;
  steps: CreateExecutionPlanRequest["steps"];
  artifacts?: NonNullable<CreateExecutionPlanRequest["artifacts"]>;
  stepCount: number;
  artifactCount: number;
  contentSha256: string;
}

export interface VerifyExecutionPlanBlueprintRequest {
  blueprint: ExecutionPlanBlueprint;
}

export type ExecutionPlanBlueprintVerificationStatus = "valid" | "invalid";

export interface ExecutionPlanBlueprintVerification {
  status: ExecutionPlanBlueprintVerificationStatus;
  diagnostics: string[];
  stepCount: number;
  artifactCount: number;
  contentSha256?: string;
  sourceThreadId?: string;
  sourcePlanId?: string;
  sourcePlanRevision?: number;
  sourcePlanArchiveSha256?: string;
  sourceEventStreamSha256?: string;
}

export interface CreateExecutionPlanFromBlueprintRequest {
  blueprint: ExecutionPlanBlueprint;
  objective?: string;
}

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

export type ExecutionPlanBlueprintRecordQualificationStatus =
  | "qualified"
  | "archived"
  | "source_missing"
  | "source_drift"
  | "invalid";

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

export type ExecutionPlanBlueprintRecordPreviewStatus =
  | "ready"
  | "not_qualified"
  | "blocked";

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

export type ExecutionPlanBlueprintRecordReplayOutcomeStatus =
  | ExecutionPlanStatus
  | "plan_missing"
  | "identity_mismatch";

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

export type ExecutionPlanBlueprintRecordReplayHistoryVerificationStatus =
  | "valid"
  | "invalid";

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

export type ExecutionPlanBlueprintRecordReplayOutcomesVerificationStatus =
  | "valid"
  | "invalid";

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

export type ExecutionPlanBlueprintRecordOutcomeQualificationStatus =
  | "qualified"
  | "missing_baseline"
  | "policy_failed";

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

export type ExecutionPlanBlueprintOutcomeReviewVerdict =
  | "promote"
  | "revise"
  | "reject"
  | "inconclusive";

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
  reviewSha256: string;
  createdAt: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyTemplateId =
  | "balanced"
  | "delivery_first"
  | "portfolio_first";

export interface ExecutionPlanBlueprintRecommendationPolicyWeights {
  outcomeCompletionBps: number;
  familyCompletionBps: number;
  reviewedBaselineBps: number;
  replayEvidenceBps: number;
}

export interface ExecutionPlanBlueprintRecommendationPolicy {
  templateId: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  weights: ExecutionPlanBlueprintRecommendationPolicyWeights;
}

export type ExecutionPlanBlueprintRecommendationPolicySource =
  | "default"
  | "request"
  | "family_override";

export interface SelectExecutionPlanBlueprintRecordRequest {
  objective?: string;
  policyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
}

export type ExecutionPlanBlueprintRecordSelectionCandidateStatus =
  | "selected"
  | "qualified"
  | "rejected";

export interface ExecutionPlanBlueprintRecordSelectionCandidate {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecordStatus;
  recordUpdatedAt: string;
  selectionStatus: ExecutionPlanBlueprintRecordSelectionCandidateStatus;
  diagnostics: string[];
  blueprintSha256: string;
  familySha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  familyRecordCount: number;
  familyOutcomeQualifiedCount: number;
  familyReviewedBaselineCount: number;
  familyCompletionRateBps: number;
  recommendationScoreBps: number;
  recommendationPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  recommendationPolicySha256: string;
  recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource;
  familyPolicyOverrideSha256?: string;
  previewStatus?: ExecutionPlanBlueprintRecordPreviewStatus;
  previewSha256?: string;
  baselineId?: string;
  baselineSha256?: string;
  baselineOutcomesSha256?: string;
  baselinePromotedAt?: string;
  currentOutcomesSha256: string;
  currentReplayHistorySha256: string;
  currentOutcomeSetSha256: string;
  scoreBps: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  stepCount: number;
  artifactCount: number;
}

export interface ExecutionPlanBlueprintRecordSelection {
  kind: "napier.execution-plan-blueprint-selection";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  objectiveSha256?: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedPreviewSha256?: string;
  selectedBaselineId?: string;
  selectedBaselineSha256?: string;
  selectedScoreBps?: number;
  selectedFamilySha256?: string;
  selectedFamilyCompletionRateBps?: number;
  selectedRecommendationScoreBps?: number;
  selectedRecommendationPolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  selectedRecommendationPolicySha256?: string;
  selectedRecommendationPolicySource?: ExecutionPlanBlueprintRecommendationPolicySource;
  selectedFamilyPolicyOverrideSha256?: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  familyPolicyOverrideCount: number;
  familyPolicyOverrideSetSha256: string;
  portfolioSetSha256: string;
  selectionSetSha256: string;
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[];
  contentSha256: string;
}

export interface ExecutionPlanBlueprintPortfolioCalibrationFamily {
  familySha256: string;
  recordCount: number;
  activeCount: number;
  archivedCount: number;
  sourceQualifiedCount: number;
  outcomeQualifiedCount: number;
  reviewedBaselineCount: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  topRecordId?: string;
  topRecordScoreBps?: number;
  latestBaselineSha256?: string;
}

export interface ExecutionPlanBlueprintPortfolioCalibration {
  kind: "napier.execution-plan-blueprint-portfolio-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordCount: number;
  activeCount: number;
  archivedCount: number;
  familyCount: number;
  sourceQualifiedCount: number;
  outcomeQualifiedCount: number;
  reviewedBaselineCount: number;
  missingBaselineCount: number;
  policyFailedCount: number;
  portfolioSetSha256: string;
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyBacktestCandidateStatus =
  | "selected"
  | "qualified"
  | "rejected";

export interface ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecordStatus;
  recordUpdatedAt: string;
  selectionStatus: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidateStatus;
  diagnostics: string[];
  familySha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualificationStatus;
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualificationStatus;
  familyRecordCount: number;
  familyCompletionRateBps: number;
  familyReviewedBaselineCount: number;
  reviewedBaselineCoverageBps: number;
  replayEvidenceBps: number;
  recommendationScoreBps: number;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  currentOutcomesSha256: string;
  currentOutcomeSetSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyBacktestResult {
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  candidateCount: number;
  qualifiedCandidateCount: number;
  rejectedCandidateCount: number;
  selectedRecordId?: string;
  selectedFamilySha256?: string;
  selectedRecommendationScoreBps?: number;
  averageRecommendationScoreBps: number;
  candidates: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate[];
}

export interface ExecutionPlanBlueprintRecommendationPolicyBacktest {
  kind: "napier.execution-plan-blueprint-recommendation-policy-backtest";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  recordCount: number;
  activeCount: number;
  policyCount: number;
  divergentSelectionCount: number;
  portfolioSetSha256: string;
  policySetSha256: string;
  results: ExecutionPlanBlueprintRecommendationPolicyBacktestResult[];
  contentSha256: string;
}

export interface SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest {
  familySha256: string;
  policyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  expectedPortfolioSetSha256?: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverride {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override";
  schemaVersion: 1;
  apiVersion: string;
  familySha256: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySha256: string;
  portfolioSetSha256: string;
  familyRecordCount: number;
  familyOutcomeQualifiedCount: number;
  familyCompletionRateBps: number;
  updatedAt: string;
  contentSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideList {
  kind: "napier.execution-plan-blueprint-recommendation-policy-overrides";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  overrideCount: number;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftStatus =
  | "aligned"
  | "retire_recommended"
  | "family_missing";

export type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftRecommendation =
  "keep" | "retire";

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  familySha256: string;
  overrideSha256: string;
  status: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftStatus;
  recommendation: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftRecommendation;
  diagnostics: string[];
  overridePolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  overridePolicySha256: string;
  overrideSelectedRecordId?: string;
  overrideSelectedRecommendationScoreBps?: number;
  bestPolicyTemplate?: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  bestPolicySha256?: string;
  bestSelectedRecordId?: string;
  bestSelectedRecommendationScoreBps?: number;
  familyRecordCount?: number;
  familyOutcomeQualifiedCount?: number;
  familyCompletionRateBps?: number;
  reviewSha256: string;
}

export interface ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  overrideCount: number;
  alignedCount: number;
  retireRecommendedCount: number;
  missingFamilyCount: number;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  reviewSetSha256: string;
  reviews: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem[];
  contentSha256: string;
}

export interface RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest {
  familySha256: string;
  expectedOverrideSha256: string;
  expectedOverrideSetSha256: string;
  expectedDriftReviewSetSha256: string;
  expectedPortfolioSetSha256: string;
}

export interface RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement";
  schemaVersion: 1;
  apiVersion: string;
  familySha256: string;
  retiredOverrideSha256: string;
  retiredRecommendationPolicyTemplate: ExecutionPlanBlueprintRecommendationPolicyTemplateId;
  retiredRecommendationPolicySha256: string;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  driftReviewSetSha256: string;
  remainingOverrideSetSha256: string;
  retiredAt: string;
  contentSha256: string;
}

export type ExecutionPlanBlueprintRecordReplayEventVerificationStatus =
  | "valid"
  | "invalid";

export interface ExecutionPlanBlueprintRecordReplayEventVerification {
  schemaVersion: 1;
  status: ExecutionPlanBlueprintRecordReplayEventVerificationStatus;
  diagnostics: string[];
  expectedRecordId: string;
  threadId: string;
  eventId: string;
  seq: number;
  declaredEventSha256: string;
  observedEventSha256?: string;
  observedReplay?: ExecutionPlanBlueprintRecordReplay;
  contentSha256: string;
}

export interface CreateExecutionPlanFromBlueprintRecordRequest {
  recordId: string;
  objective?: string;
  expectedPreviewSha256?: string;
}

export type MemoryCategory =
  | "preference"
  | "context"
  | "goal"
  | "constraint"
  | "decision"
  | "identity"
  | "behavior"
  | "correction"
  | "other";

export type MemoryScope = "workspace" | "agent";
export type MemoryStatus =
  | "proposed"
  | "active"
  | "stale"
  | "rejected"
  | "archived";

export interface MemorySource {
  type: "manual" | "conversation";
  threadId?: string;
  runId?: string;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: MemoryCategory;
  scope: MemoryScope;
  agentId?: string;
  status: MemoryStatus;
  confidence: number;
  source: MemorySource;
  reviewNote?: string;
  reviewIntervalDays: number;
  reviewDueAt?: string;
  useCount: number;
  lastUsedAt?: string;
  lastUsedRunId?: string;
  supersedesMemoryId?: string;
  consolidatesMemoryIds?: string[];
  supersededByMemoryId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface CreateMemoryRequest {
  content: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  agentId?: string;
  confidence?: number;
  reviewIntervalDays?: number;
  supersedesMemoryId?: string;
  consolidatesMemoryIds?: string[];
  threadId?: string;
}

export interface ReviewMemoryRequest {
  action:
    | "approve"
    | "reject"
    | "archive"
    | "restore"
    | "refresh"
    | "mark_stale";
  note?: string;
  threadId?: string;
}

export interface ModelRef {
  provider: string;
  id: string;
}

export type CredentialReferenceSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "macos_keychain";
      service: string;
      account: string;
    };

export type CredentialReferenceStatus = "active" | "disabled";
export type CredentialAvailability =
  | "unknown"
  | "available"
  | "missing"
  | "error";

export interface CredentialReference {
  id: string;
  providerId: string;
  label: string;
  source: CredentialReferenceSource;
  status: CredentialReferenceStatus;
  availability: CredentialAvailability;
  lastCheckedAt?: string;
  lastError?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCredentialReferenceRequest {
  providerId: string;
  label: string;
  source: CredentialReferenceSource;
  threadId?: string;
}

export interface CreateMacOsKeychainCredentialRequest {
  providerId: string;
  label: string;
  service: string;
  account: string;
  secret: string;
  replaceExisting?: boolean;
  threadId?: string;
}

export interface SetCredentialReferenceStatusRequest {
  status: CredentialReferenceStatus;
  threadId?: string;
}

export type ToolPolicyMode = "observe" | "workspace" | "unrestricted";

export type SubagentRole = "researcher" | "reviewer" | "general";
export type SubagentTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";
export type SubagentStopReason =
  | "completed"
  | "turn_capped"
  | "timeout"
  | "cancelled"
  | "error";

export interface SubagentLimits {
  maxConcurrent: number;
  maxTotal: number;
  maxTurns: number;
  timeoutMs: number;
}

export interface RunLimits {
  maxTurns: number;
  maxTotalTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
}

export type AutomaticRecoveryMode = "manual" | "safe_read_only";

export interface AutomaticRecoveryPolicy {
  mode: AutomaticRecoveryMode;
  maxAttempts: number;
  backoffMs: number;
}

export type RunExecutionMode = "standard" | "safe_read_only_recovery";

export interface SubagentTask {
  id: string;
  threadId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  prompt: string;
  status: SubagentTaskStatus;
  result?: string;
  error?: string;
  stopReason?: SubagentStopReason;
  model: ModelRef;
  stepCount: number;
  turnCount: number;
  usage: Usage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  revision: number;
}

export type ExtensionCapability =
  | "network.connect"
  | "secrets.env"
  | "process.spawn"
  | "workspace.read"
  | "workspace.write"
  | "external.read"
  | "external.write";
export type ExtensionTrustStatus = "pending" | "approved" | "rejected";
export type McpToolReviewStatus = "pending" | "approved" | "rejected";
export type McpToolEffect = "read" | "write" | "unknown";
export type ExtensionConnectionStatus =
  | "untested"
  | "connecting"
  | "ready"
  | "error"
  | "disconnected";

export interface McpHttpTransportConfig {
  type: "streamable_http";
  url: string;
  headerEnv?: Record<string, string>;
}

export interface McpStdioTransportConfig {
  type: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export type McpTransportConfig =
  | McpHttpTransportConfig
  | McpStdioTransportConfig;

export interface ExtensionProvenance {
  source: "manual" | "signed_package";
  locator: string;
  digestSha256: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  publisherKeyId?: string;
}

export interface McpToolRecord {
  name: string;
  normalizedName: string;
  directName: string;
  description: string;
  routingHint?: string;
  inputSchema: JsonValue;
  schemaSha256: string;
  reviewStatus: McpToolReviewStatus;
  effect: McpToolEffect;
  reviewNote?: string;
  reviewedAt?: string;
}

export interface ExtensionConnection {
  status: ExtensionConnectionStatus;
  toolCount: number;
  testedAt?: string;
  error?: string;
}

export type ExtensionPublisherTrustAnchorStatus = "trusted" | "revoked";

export type CreateExtensionPublisherTrustAnchorSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "public_key";
      publicKeySpki: string;
    };

export interface ExtensionPublisherTrustAnchor {
  id: string;
  label: string;
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  signingSource?: {
    type: "environment";
    variable: string;
  };
  status: ExtensionPublisherTrustAnchorStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  contentSha256: string;
}

export interface CreateExtensionPublisherTrustAnchorRequest {
  threadId: string;
  label: string;
  source: CreateExtensionPublisherTrustAnchorSource;
}

export interface RevokeExtensionPublisherTrustAnchorRequest {
  threadId: string;
}

export interface ExtensionPackageManifestTool {
  name: string;
  normalizedName: string;
  description: string;
  routingHint?: string;
  inputSchema: JsonValue;
  schemaSha256: string;
  effect: Exclude<McpToolEffect, "unknown">;
}

export interface ExtensionPackageDependency {
  normalizedName: string;
  versionRange: string;
}

export interface ExtensionPackageManifest {
  kind: "napier.extension-package-manifest";
  schemaVersion: 1 | 2;
  apiVersion: string;
  publisher: string;
  name: string;
  normalizedName: string;
  description: string;
  version: string;
  extensionKind: "mcp";
  transport: McpTransportConfig;
  transportSha256: string;
  requestedCapabilities: ExtensionCapability[];
  tools: ExtensionPackageManifestTool[];
  dependencies?: ExtensionPackageDependency[];
  executable?: {
    path: string;
    sizeBytes: number;
    sha256: string;
  };
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface ExtensionPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedExtensionPackageEnvelope {
  kind: "napier.signed-extension-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: ExtensionPackageManifest;
  signature: ExtensionPackageSignature;
  contentSha256: string;
}

export interface ExtensionPackageBinding {
  envelope: SignedExtensionPackageEnvelope;
  importedAt: string;
  contentSha256: string;
}

export interface ExtensionPackageHistoryEntry {
  sequence: number;
  binding: ExtensionPackageBinding;
  supersededAt: string;
  supersededByEnvelopeSha256: string;
  contentSha256: string;
}

export type ExtensionPackageVersionDirection =
  | "upgrade"
  | "same"
  | "regression"
  | "unknown";

export type ExtensionPackageChange =
  | "publisher"
  | "version"
  | "metadata"
  | "transport"
  | "capabilities"
  | "tools"
  | "effects"
  | "dependencies"
  | "executable"
  | "lifecycle"
  | "signature";

export interface ExtensionPackageUpdateIdentity {
  publisher: string;
  keyId: string;
  version: string;
  manifestSha256: string;
  envelopeSha256: string;
}

export interface ExtensionPackageToolChanges {
  added: string[];
  removed: string[];
  schemaChanged: string[];
  effectChanged: string[];
  descriptionChanged: string[];
  routingHintChanged: string[];
}

export interface ExtensionPackageDependencyChanges {
  added: ExtensionPackageDependency[];
  removed: ExtensionPackageDependency[];
  changed: Array<{
    normalizedName: string;
    currentVersionRange: string;
    nextVersionRange: string;
  }>;
}

export interface ExtensionPackageUpdatePreview {
  kind: "napier.extension-package-update-preview";
  schemaVersion: 1;
  apiVersion: string;
  extensionId: string;
  expectedPackageBindingSha256: string;
  current: ExtensionPackageUpdateIdentity;
  next: ExtensionPackageUpdateIdentity;
  versionDirection: ExtensionPackageVersionDirection;
  publisherChanged: boolean;
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  transportChanged: boolean;
  executableChanged: boolean;
  metadataChanged: boolean;
  capabilitiesAdded: ExtensionCapability[];
  capabilitiesRemoved: ExtensionCapability[];
  tools: ExtensionPackageToolChanges;
  dependencies: ExtensionPackageDependencyChanges;
  changes: ExtensionPackageChange[];
  noChanges: boolean;
  resetsLocalReview: true;
  generatedAt: string;
  contentSha256: string;
}

export interface ApplyExtensionPackageUpdateResult {
  extension: ExtensionRecord;
  preview: ExtensionPackageUpdatePreview;
  updated: boolean;
}

export type ExtensionPackageDeploymentAction = "install" | "update";

export interface ExtensionPackageDependencyResolution {
  dependentName: string;
  dependencyName: string;
  versionRange: string;
  resolvedVersion: string;
  resolvedExtensionId?: string;
  source: "candidate" | "installed";
}

export interface ExtensionPackageDeploymentItem {
  action: ExtensionPackageDeploymentAction;
  normalizedName: string;
  extensionId?: string;
  current?: ExtensionPackageUpdateIdentity;
  next: ExtensionPackageUpdateIdentity;
  expectedPackageBindingSha256?: string;
  versionDirection: ExtensionPackageVersionDirection | "install";
  publisherChanged: boolean;
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  dependencies: ExtensionPackageDependency[];
  changes: ExtensionPackageChange[];
  noChanges: boolean;
  updatePreview?: ExtensionPackageUpdatePreview;
}

export interface ExtensionPackageDeploymentPreview {
  kind: "napier.extension-package-deployment-preview";
  schemaVersion: 1;
  apiVersion: string;
  candidateCount: number;
  installCount: number;
  updateCount: number;
  items: ExtensionPackageDeploymentItem[];
  applyOrder: string[];
  resolutions: ExtensionPackageDependencyResolution[];
  requiresPublisherConfirmation: boolean;
  requiresVersionOverride: boolean;
  noChanges: boolean;
  resetsLocalReview: true;
  generatedAt: string;
  contentSha256: string;
}

export interface PreviewExtensionPackageDeploymentRequest {
  envelopes: unknown[];
}

export interface ApplyExtensionPackageDeploymentRequest {
  threadId: string;
  envelopes: unknown[];
  expectedDeploymentSha256: string;
  confirmPublisherChanges?: boolean;
  confirmVersionOverrides?: boolean;
}

export interface ApplyExtensionPackageDeploymentResult {
  extensions: ExtensionRecord[];
  preview: ExtensionPackageDeploymentPreview;
  installedExtensionIds: string[];
  updatedExtensionIds: string[];
}

export interface ExtensionPackageLockfileEntry {
  normalizedName: string;
  version: string;
  publisher: string;
  keyId: string;
  manifestSha256: string;
  envelopeSha256: string;
  dependencies: ExtensionPackageDependency[];
  envelope: SignedExtensionPackageEnvelope;
}

export interface ExtensionPackageLockfile {
  kind: "napier.extension-package-lockfile";
  schemaVersion: 1;
  apiVersion: string;
  packages: ExtensionPackageLockfileEntry[];
  generatedAt: string;
  contentSha256: string;
}

export type ExtensionPackageLockfileVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid";

export interface ExtensionPackageLockfileVerification {
  status: ExtensionPackageLockfileVerificationStatus;
  verifiedAt: string;
  packageCount: number;
  lockfileSha256?: string;
  packageEnvelopeSha256es: string[];
  reason: string;
}

export interface ExportExtensionPackageLockfileRequest {
  threadId: string;
  extensionIds?: string[];
}

export interface VerifyExtensionPackageLockfileRequest {
  lockfile: unknown;
}

export interface ExtensionPackageRolloutPolicy {
  kind: "napier.extension-package-rollout-policy";
  schemaVersion: 1;
  maxPackages: number;
  requireTrustedPublishers: true;
  requireDependencyClosure: true;
  allowedPublisherKeyIds: string[];
  allowedPackageNames: string[];
}

export interface ExtensionPackageRolloutChannel {
  id: string;
  name: string;
  normalizedName: string;
  description: string;
  status: "active";
  policy: ExtensionPackageRolloutPolicy;
  lockfile: ExtensionPackageLockfile;
  lockfileSha256: string;
  packageCount: number;
  dependencyCount: number;
  packageEnvelopeIdsSha256: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

export interface PublishExtensionPackageRolloutChannelRequest {
  threadId: string;
  name: string;
  description?: string;
  extensionIds?: string[];
  expectedRevision?: number;
  policy?: {
    maxPackages?: number;
    allowedPublisherKeyIds?: string[];
    allowedPackageNames?: string[];
  };
}

export interface ExtensionPackageRolloutPreview {
  kind: "napier.extension-package-rollout-preview";
  schemaVersion: 1;
  apiVersion: string;
  channelId: string;
  channelName: string;
  channelRevision: number;
  policy: ExtensionPackageRolloutPolicy;
  lockfileSha256: string;
  verification: ExtensionPackageLockfileVerification;
  deploymentPreview: ExtensionPackageDeploymentPreview;
  generatedAt: string;
  contentSha256: string;
}

export interface PreviewExtensionPackageRolloutChannelRequest {
  channelId: string;
}

export interface ApplyExtensionPackageRolloutChannelRequest {
  threadId: string;
  channelId: string;
  expectedRolloutSha256: string;
  expectedDeploymentSha256: string;
  confirmPublisherChanges?: boolean;
  confirmVersionOverrides?: boolean;
}

export interface ApplyExtensionPackageRolloutChannelResult {
  channel: ExtensionPackageRolloutChannel;
  rolloutPreview: ExtensionPackageRolloutPreview;
  deployment: ApplyExtensionPackageDeploymentResult;
}

export interface ExtensionPackageChannelIndexEntry {
  name: string;
  normalizedName: string;
  channelRevision: number;
  channelSha256: string;
  lockfileSha256: string;
  lockfileLocator?: string;
  packageCount: number;
  dependencyCount: number;
  packageEnvelopeIdsSha256: string;
  policySha256: string;
}

export interface ExtensionPackageChannelIndex {
  kind: "napier.extension-package-channel-index";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  channels: ExtensionPackageChannelIndexEntry[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface ExtensionPackageChannelIndexSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  indexArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedExtensionPackageChannelIndexEnvelope {
  kind: "napier.signed-extension-package-channel-index";
  schemaVersion: 1;
  apiVersion: string;
  index: ExtensionPackageChannelIndex;
  signature: ExtensionPackageChannelIndexSignature;
  contentSha256: string;
}

export type ExtensionPackageChannelIndexVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid";

export interface ExtensionPackageChannelIndexVerification {
  status: ExtensionPackageChannelIndexVerificationStatus;
  verifiedAt: string;
  channelCount: number;
  indexSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignExtensionPackageChannelIndexRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  channelIds?: string[];
  lockfileBaseUrl?: string;
  expiresAt?: string;
}

export interface VerifyExtensionPackageChannelIndexRequest {
  envelope: unknown;
}

export type ExtensionPackageVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid"
  | "configuration_drift"
  | "executable_mismatch";

export interface ExtensionPackageVerification {
  status: ExtensionPackageVerificationStatus;
  verifiedAt: string;
  signatureValid: boolean;
  integrityValid: boolean;
  configurationValid: boolean;
  executableValid?: boolean;
  publisher?: string;
  packageName?: string;
  packageVersion?: string;
  keyId?: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  transportSha256?: string;
  reason: string;
}

export interface ExtensionRecord {
  id: string;
  kind: "mcp";
  name: string;
  normalizedName: string;
  description: string;
  version: string;
  provenance: ExtensionProvenance;
  requestedCapabilities: ExtensionCapability[];
  approvedCapabilities: ExtensionCapability[];
  trustStatus: ExtensionTrustStatus;
  enabledAgentIds: string[];
  transport: McpTransportConfig;
  packageBinding?: ExtensionPackageBinding;
  packageHistory?: ExtensionPackageHistoryEntry[];
  connection: ExtensionConnection;
  tools: McpToolRecord[];
  reviewNote?: string;
  reviewedAt?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpExtensionRequest {
  name: string;
  description?: string;
  version?: string;
  transport: McpTransportConfig;
  requestedCapabilities?: ExtensionCapability[];
  threadId?: string;
}

export interface SignExtensionPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  dependencies?: ExtensionPackageDependency[];
  expiresAt?: string;
}

export interface VerifySignedExtensionPackageRequest {
  envelope: unknown;
}

export interface ImportSignedExtensionPackageRequest {
  threadId: string;
  envelope: unknown;
}

export interface PreviewExtensionPackageUpdateRequest {
  envelope: unknown;
}

export interface ApplyExtensionPackageUpdateRequest {
  threadId: string;
  envelope: unknown;
  expectedPackageBindingSha256: string;
  confirmPublisherChange?: boolean;
  confirmVersionOverride?: boolean;
}

export interface ReviewExtensionRequest {
  action: "approve" | "reject";
  approvedCapabilities?: ExtensionCapability[];
  note?: string;
  threadId?: string;
}

export interface SetExtensionEnabledRequest {
  agentId: string;
  enabled: boolean;
  threadId?: string;
}

export interface ReviewMcpToolRequest {
  action: "approve" | "reject";
  effect?: McpToolEffect;
  routingHint?: string;
  note?: string;
  threadId?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: ModelRef;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high";
  toolPolicy: ToolPolicyMode;
  enabledTools: string[];
  enabledSkills: string[];
  enabledSubagents?: SubagentRole[];
  subagentLimits?: SubagentLimits;
  runLimits?: RunLimits;
  automaticRecovery?: AutomaticRecoveryPolicy;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentProfileField =
  | "name"
  | "description"
  | "systemPrompt"
  | "model"
  | "thinkingLevel"
  | "toolPolicy"
  | "enabledTools"
  | "enabledSkills"
  | "enabledSubagents"
  | "subagentLimits"
  | "runLimits"
  | "automaticRecovery";

export type AgentProfileRevisionSource =
  | "created"
  | "updated"
  | "rollback"
  | "imported"
  | "migrated";

export interface AgentProfileRevision {
  agentId: string;
  revision: number;
  profile: AgentProfile;
  changedFields: AgentProfileField[];
  source: AgentProfileRevisionSource;
  restoredFromRevision?: number;
  systemPromptSha256: string;
  createdAt: string;
  contentSha256: string;
}

export interface UpdateAgentProfileRequest {
  name?: string;
  description?: string;
  systemPrompt?: string;
  model?: ModelRef;
  thinkingLevel?: AgentProfile["thinkingLevel"];
  toolPolicy?: ToolPolicyMode;
  enabledTools?: string[];
  enabledSkills?: string[];
  enabledSubagents?: SubagentRole[];
  subagentLimits?: SubagentLimits;
  runLimits?: RunLimits;
  automaticRecovery?: AutomaticRecoveryPolicy;
  threadId?: string;
}

export interface RollbackAgentProfileRequest {
  revision: number;
  threadId: string;
}

export interface AgentProfileRollbackResult {
  agent: AgentProfile;
  revision: AgentProfileRevision;
}

export interface ThreadSummary {
  id: string;
  title: string;
  agentId: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  eventCount: number;
  goal?: GoalState;
}

export interface ThreadImportProvenance {
  sourceThreadId: string;
  sourceApiVersion: string;
  sourceContentSha256: string;
  sourceEventStreamSha256: string;
  sourceEventCount: number;
  importedAt: string;
}

export interface ThreadRecord extends ThreadSummary {
  currentRunId?: string;
  runIds: string[];
  importProvenance?: ThreadImportProvenance;
}

interface RunConfigurationFingerprintBase {
  agentRevision: number;
  model: ModelRef;
  thinkingLevel: AgentProfile["thinkingLevel"];
  toolPolicy: ToolPolicyMode;
  enabledTools: string[];
  enabledSkills: string[];
  enabledSubagents: SubagentRole[];
  subagentLimits: SubagentLimits;
  runLimits: RunLimits;
  systemPromptSha256: string;
  contentSha256: string;
}

export interface RunConfigurationFingerprintV1 extends RunConfigurationFingerprintBase {
  schemaVersion: 1;
}

export interface RunConfigurationFingerprintV2 extends RunConfigurationFingerprintBase {
  schemaVersion: 2;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
}

export interface RunConfigurationFingerprintV3 extends RunConfigurationFingerprintBase {
  schemaVersion: 3;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
}

export type RunConfigurationFingerprint =
  | RunConfigurationFingerprintV1
  | RunConfigurationFingerprintV2
  | RunConfigurationFingerprintV3;

export type AutomaticRecoveryBlockReason =
  | "configuration_missing"
  | "legacy_configuration"
  | "policy_manual"
  | "run_not_interrupted"
  | "demo_model"
  | "event_limit_exceeded"
  | "unresolved_tool_call"
  | "unsafe_tool_effect"
  | "unknown_tool_effect"
  | "attempt_limit_reached"
  | "untrusted_recovery_chain";

export interface AutomaticRecoveryAssessment {
  schemaVersion: 1;
  threadId: string;
  runId: string;
  rootRunId: string;
  agentId: string;
  runConfigurationSha256?: string;
  policy: AutomaticRecoveryPolicy;
  eligible: boolean;
  blockReasons: AutomaticRecoveryBlockReason[];
  toolCalls: {
    total: number;
    readOnly: number;
    unsafe: number;
    unknownEffect: number;
    unresolved: number;
  };
  unsafeToolNames: string[];
  unknownEffectToolNames: string[];
  unresolvedToolNames: string[];
  eventRange: {
    fromSeq: number;
    toSeq: number;
    eventCount: number;
    eventStreamSha256: string;
  };
  priorAttempts: number;
  eligibleAt: string;
  assessedAt: string;
  contentSha256: string;
}

export type AutomaticRecoveryAttemptStatus =
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "abandoned";

export interface AutomaticRecoveryAttempt {
  id: string;
  threadId: string;
  agentId: string;
  rootRunId: string;
  interruptedRunId: string;
  attempt: number;
  maxAttempts: number;
  triggerId: string;
  assessmentSha256: string;
  status: AutomaticRecoveryAttemptStatus;
  claim?: {
    ownerId: string;
    acquiredAt: string;
    heartbeatAt: string;
    expiresAt: string;
    revision: number;
  };
  recoveryRunId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  revision: number;
  contentSha256: string;
}

export interface AutomaticRecoveryClaim {
  assessment: AutomaticRecoveryAssessment;
  attempt: AutomaticRecoveryAttempt;
  token: string;
}

export interface RunRecord {
  id: string;
  threadId: string;
  agentId: string;
  status: RunStatus;
  source?: RunInvocationSource;
  triggerId?: string;
  startedAt: string;
  finishedAt?: string;
  parentRunId?: string;
  branchFromSeq?: number;
  interruptedAt?: string;
  interruptionReason?: string;
  usage: Usage;
  agentRevision?: number;
  limits?: RunLimits;
  configuration?: RunConfigurationFingerprint;
  error?: string;
  lease?: RunLeaseSummary;
}

export interface RunLeaseSummary {
  ownerId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  revision: number;
}

export interface RunLeaseHandle {
  run: RunRecord;
  token: string;
}

export type ScheduleStatus = "active" | "paused";
export type ScheduleTrigger =
  | {
      type: "interval";
      everyMs: number;
      anchorAt?: string;
    }
  | {
      type: "cron";
      expression: string;
      timezone: "UTC";
    };

export interface AutomationSchedule {
  id: string;
  name: string;
  threadId: string;
  prompt: string;
  model?: ModelRef;
  trigger: ScheduleTrigger;
  status: ScheduleStatus;
  overlapPolicy: "skip";
  misfirePolicy: "run_once" | "skip";
  nextRunAt: string;
  lastScheduledFor?: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastError?: string;
  claim?: {
    ownerId: string;
    scheduledFor: string;
    acquiredAt: string;
    expiresAt: string;
    revision: number;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationScheduleRequest {
  name: string;
  threadId: string;
  prompt: string;
  model?: ModelRef;
  trigger: ScheduleTrigger;
  status?: ScheduleStatus;
  misfirePolicy?: AutomationSchedule["misfirePolicy"];
}

export interface UpdateAutomationScheduleRequest {
  name?: string;
  prompt?: string;
  model?: ModelRef;
  trigger?: ScheduleTrigger;
  status?: ScheduleStatus;
  misfirePolicy?: AutomationSchedule["misfirePolicy"];
}

export interface ScheduleClaim {
  schedule: AutomationSchedule;
  token: string;
  scheduledFor: string;
}

export type InboundChannelStatus = "active" | "disabled";
export type InboundChannelAdapter =
  | "napier_json"
  | "github_webhook"
  | "slack_event"
  | "linear_webhook";
export type InboundDeliveryStatus =
  | "accepted"
  | "running"
  | "retrying"
  | "completed"
  | "failed";

export interface InboundRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface InboundSignaturePolicy {
  required: boolean;
  algorithm: "hmac-sha256";
  header: "X-Napier-Channel-Signature";
  timestampHeader: "X-Napier-Channel-Timestamp";
  toleranceSeconds: number;
}

export type InboundChannelPolicyTemplateId =
  | "legacy_bearer"
  | "signed_standard"
  | "signed_strict"
  | "custom";

export interface InboundChannel {
  id: string;
  type: "webhook";
  adapter: InboundChannelAdapter;
  name: string;
  threadId: string;
  status: InboundChannelStatus;
  tokenFingerprint: string;
  policyTemplate: InboundChannelPolicyTemplateId;
  signaturePolicy: InboundSignaturePolicy;
  retryPolicy: InboundRetryPolicy;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedInboundChannel {
  channel: InboundChannel;
  token: string;
}

export interface CreateInboundChannelRequest {
  name: string;
  threadId: string;
  adapter?: InboundChannelAdapter;
  policyTemplate?: InboundChannelPolicyTemplateId;
  retryPolicy?: InboundRetryPolicy;
  signaturePolicy?: {
    required: boolean;
    toleranceSeconds?: number;
  };
}

export interface SetInboundChannelStatusRequest {
  status: InboundChannelStatus;
}

export interface UpdateInboundRetryPolicyRequest {
  retryPolicy: InboundRetryPolicy;
}

export interface UpdateInboundSignaturePolicyRequest {
  signaturePolicy: {
    required: boolean;
    toleranceSeconds?: number;
  };
}

export interface InboundChannelAdapterDescriptor {
  id: InboundChannelAdapter;
  label: string;
  description: string;
  idempotencySource: string;
  requiredHeaders: string[];
  sampleHeaders: Record<string, string>;
  sampleBody: string;
  securityNote: string;
}

export interface PreviewInboundChannelAdapterRequest {
  body: string;
  headers?: Record<string, string>;
}

export interface InboundChannelAdapterPreview {
  channelId: string;
  adapter: InboundChannelAdapter;
  bodySha256: string;
  idempotencyFingerprint: string;
  messageSha256: string;
  messagePreview: string;
  model?: ModelRef;
  contentSha256: string;
}

export interface InboundMessageRequest {
  idempotencyKey: string;
  message: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  model?: ModelRef;
}

export interface InboundDelivery {
  id: string;
  channelId: string;
  threadId: string;
  idempotencyFingerprint: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  status: InboundDeliveryStatus;
  triggerId: string;
  attemptCount: number;
  maxAttempts: number;
  retryBaseMs: number;
  runId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  finishedAt?: string;
  revision: number;
}

export interface InboundReceipt {
  delivery: InboundDelivery;
  duplicate: boolean;
}

export type InboundDeliveryQualificationStatus =
  | "qualified"
  | "evidence_missing"
  | "adapter_catalog_drift";

export interface InboundDeliveryQualification {
  schemaVersion: 1;
  channelId: string;
  deliveryId: string;
  status: InboundDeliveryQualificationStatus;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  currentAdapterCatalogSha256: string;
  diagnostics: string[];
  contentSha256: string;
}

export type InboundDeadLetterRetryDisposition =
  | "manual_retry_available"
  | "retry_exhausted";

export interface InboundDeadLetter {
  deliveryId: string;
  threadId: string;
  idempotencyFingerprint: string;
  triggerId: string;
  attemptCount: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryDisposition: InboundDeadLetterRetryDisposition;
  qualificationStatus?: InboundDeliveryQualificationStatus;
  messageSha256: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  error: string;
  runId?: string;
  createdAt: string;
  lastAttemptAt?: string;
  finishedAt?: string;
}

export interface InboundDeadLetterExport {
  schemaVersion: 1;
  exportedAt: string;
  channel: {
    id: string;
    name: string;
    threadId: string;
    status: InboundChannelStatus;
    retryPolicy: InboundRetryPolicy;
    revision: number;
  };
  currentAdapterCatalogSha256?: string;
  qualifiedCount?: number;
  evidenceMissingCount?: number;
  adapterCatalogDriftCount?: number;
  deliveryCount: number;
  deliveries: InboundDeadLetter[];
  contentSha256: string;
}

export interface VerifyInboundDeadLetterExportRequest {
  artifact: unknown;
}

export type InboundDeadLetterExportVerificationStatus = "valid" | "invalid";

export interface InboundDeadLetterExportVerification {
  schemaVersion: 1;
  status: InboundDeadLetterExportVerificationStatus;
  diagnostics: string[];
  channelId?: string;
  expectedChannelId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  deliveryCount?: number;
  observedDeliveryCount?: number;
  qualifiedCount?: number;
  observedQualifiedCount?: number;
  evidenceMissingCount?: number;
  observedEvidenceMissingCount?: number;
  adapterCatalogDriftCount?: number;
  observedAdapterCatalogDriftCount?: number;
  contentSha256: string;
}

export interface PreviewInboundDeadLetterRetryRequest {
  artifact: unknown;
}

export interface ApplyInboundDeadLetterRetryRequest {
  artifact: unknown;
  expectedPreviewSha256: string;
  confirmReplay: boolean;
}

export type InboundDeadLetterRetryCandidateStatus =
  | "retryable"
  | "artifact_invalid"
  | "not_found"
  | "not_failed"
  | "retry_exhausted"
  | "state_changed";

export interface InboundDeadLetterRetryCandidate {
  deliveryId: string;
  status: InboundDeadLetterRetryCandidateStatus;
  diagnostics: string[];
  idempotencyFingerprint?: string;
  attemptCount?: number;
  maxAttempts?: number;
  bodySha256?: string;
  adapterCatalogSha256?: string;
}

export interface InboundDeadLetterRetryPreview {
  schemaVersion: 1;
  channelId: string;
  verificationStatus: InboundDeadLetterExportVerificationStatus;
  artifactSha256?: string;
  retryableCount: number;
  blockedCount: number;
  candidateSetSha256: string;
  retryableDeliveryIdsSha256: string;
  blockedDeliveryIdsSha256: string;
  diagnostics: string[];
  candidates: InboundDeadLetterRetryCandidate[];
  contentSha256: string;
}

export interface InboundDeadLetterRetryApplyResult {
  schemaVersion: 1;
  channelId: string;
  previewSha256: string;
  artifactSha256?: string;
  previewCandidateSetSha256: string;
  previewRetryableDeliveryIdsSha256: string;
  previewBlockedDeliveryIdsSha256: string;
  retriedCount: number;
  skippedCount: number;
  retriedDeliveryIdsSha256: string;
  skippedDeliveryIdsSha256: string;
  deliveries: InboundDelivery[];
  skipped: InboundDeadLetterRetryCandidate[];
  contentSha256: string;
}

export interface InboundDeadLetterRetryAuditRecord {
  eventId: string;
  seq: number;
  createdAt: string;
  channelId: string;
  applyResultSha256?: string;
  previewSha256: string;
  artifactSha256?: string;
  previewCandidateSetSha256: string;
  previewRetryableDeliveryIdsSha256: string;
  previewBlockedDeliveryIdsSha256: string;
  retriedCount: number;
  skippedCount: number;
  retriedDeliveryIdsSha256: string;
  skippedDeliveryIdsSha256: string;
}

export interface InboundDeadLetterRetryHistory {
  schemaVersion: 1;
  channelId: string;
  eventCount: number;
  fromSeq?: number;
  toSeq?: number;
  eventSetSha256: string;
  records: InboundDeadLetterRetryAuditRecord[];
  contentSha256: string;
}

export interface VerifyInboundDeadLetterRetryHistoryRequest {
  history: unknown;
}

export type InboundDeadLetterRetryHistoryVerificationStatus =
  | "valid"
  | "invalid";

export interface InboundDeadLetterRetryHistoryVerification {
  schemaVersion: 1;
  status: InboundDeadLetterRetryHistoryVerificationStatus;
  diagnostics: string[];
  channelId?: string;
  expectedChannelId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  observedContentSha256?: string;
  declaredEventSetSha256?: string;
  observedEventSetSha256?: string;
  eventCount?: number;
  observedEventCount?: number;
  fromSeq?: number;
  observedFromSeq?: number;
  toSeq?: number;
  observedToSeq?: number;
  contentSha256: string;
}

export interface ContextCheckpointSnapshot {
  schemaVersion: 1;
  checkpointId: string;
  parentCheckpointId?: string;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceEventCount: number;
  sourceSha256: string;
  summarySha256: string;
  summary: string;
  decisions: string[];
  openLoops: string[];
  artifacts: string[];
}

export type ContextCheckpointCalibrationState =
  | "verified"
  | "drifted"
  | "malformed";

export interface ContextCheckpointCalibrationSample {
  eventId: string;
  runId?: string;
  seq: number;
  state: ContextCheckpointCalibrationState;
  reason: string;
  checkpointId?: string;
  parentCheckpointId?: string;
  fromSeq?: number;
  toSeq?: number;
  retainedFromSeq?: number;
  sourceEventCount?: number;
  coveredMessageCount: number;
  sourceCharacterCount: number;
  summaryCharacterCount: number;
  compressionRatio: number;
  decisionCount: number;
  openLoopCount: number;
  artifactCount: number;
  sourceSha256?: string;
  summarySha256?: string;
  sampleSha256: string;
}

export interface ContextCompactionFailureSample {
  eventId: string;
  runId?: string;
  seq: number;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceEventCount: number;
  fallbackMessageCount: number;
  omittedMessageCount: number;
  messageSha256: string;
  failureSha256: string;
}

export interface ContextCheckpointCalibrationReport {
  kind: "napier.context-checkpoint-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  eventStreamSha256: string;
  messageEventCount: number;
  checkpointCount: number;
  verifiedCheckpointCount: number;
  driftedCheckpointCount: number;
  malformedCheckpointCount: number;
  failureCount: number;
  coveredMessageCount: number;
  coverageRate: number;
  sourceCharacterCount: number;
  summaryCharacterCount: number;
  compressionRatio: number;
  fallbackOmittedMessageCount: number;
  latestValidCheckpointId?: string;
  latestValidCheckpointSampleSha256?: string;
  samples: ContextCheckpointCalibrationSample[];
  failures: ContextCompactionFailureSample[];
  contentSha256: string;
}

export interface RunMetrics {
  durationMs: number;
  eventCount: number;
  messageCount: number;
  modelResponseCount: number;
  toolCallCount: number;
  toolCompletedCount: number;
  toolFailedCount: number;
  toolBlockedCount: number;
  subagentCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  assistantTextSha256: string;
}

export interface RunReplaySnapshot {
  schemaVersion: 1;
  generatedAt: string;
  threadId: string;
  run: RunRecord;
  metrics: RunMetrics;
  events: RunEvent[];
  subagents: SubagentTask[];
  eventStreamSha256: string;
  configurationSha256?: string;
  contentSha256: string;
}

export interface VerifyRunReplaySnapshotRequest {
  snapshot: RunReplaySnapshot;
}

export type RunReplaySnapshotVerificationStatus = "valid" | "invalid";

export interface RunReplaySnapshotVerification {
  status: RunReplaySnapshotVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  subagentCount: number;
  threadId?: string;
  runId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  configurationSha256?: string;
  assistantTextSha256?: string;
}

export type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number };

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpSpanEvent {
  timeUnixNano: string;
  name: string;
  attributes: OtlpKeyValue[];
  droppedAttributesCount: number;
}

export interface OtlpSpanStatus {
  code: 0 | 1 | 2;
  message?: string;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceState: string;
  name: string;
  kind: 1 | 3;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  droppedAttributesCount: number;
  events: OtlpSpanEvent[];
  droppedEventsCount: number;
  links: [];
  droppedLinksCount: number;
  status: OtlpSpanStatus;
  flags: 1;
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans: Array<{
    resource: {
      attributes: OtlpKeyValue[];
      droppedAttributesCount: number;
    };
    scopeSpans: Array<{
      scope: {
        name: string;
        version: string;
      };
      spans: OtlpSpan[];
      schemaUrl: string;
    }>;
    schemaUrl: string;
  }>;
}

export interface OpenTelemetryTraceArtifact {
  kind: "napier.opentelemetry-trace";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  runId?: string;
  traceId: string;
  eventRange: {
    fromSeq: number;
    toSeq: number;
    eventCount: number;
    eventStreamSha256: string;
  };
  spanCount: number;
  redaction: {
    mode: "metadata_only";
    contentCapture: false;
    excludedEventTypes: string[];
    excludedPayloadKeys: string[];
  };
  otlp: OtlpExportTraceServiceRequest;
  contentSha256: string;
}

export interface ExportOpenTelemetryTraceRequest {
  runId?: string;
}

export interface VerifyOpenTelemetryTraceArtifactRequest {
  artifact: OpenTelemetryTraceArtifact;
}

export type OpenTelemetryTraceArtifactVerificationStatus = "valid" | "invalid";

export interface OpenTelemetryTraceArtifactVerification {
  status: OpenTelemetryTraceArtifactVerificationStatus;
  diagnostics: string[];
  spanCount: number;
  eventCount: number;
  threadId?: string;
  runId?: string;
  traceId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
}

export type RunMetricDelta = Omit<RunMetrics, "assistantTextSha256">;

export type RunConfigurationField =
  | "agentRevision"
  | "model"
  | "systemPrompt"
  | "thinkingLevel"
  | "toolPolicy"
  | "enabledTools"
  | "enabledSkills"
  | "enabledSubagents"
  | "subagentLimits"
  | "runLimits"
  | "automaticRecovery"
  | "executionMode"
  | "skillCatalog";

export interface RunConfigurationDelta {
  status: "comparable" | "unavailable";
  leftSha256?: string;
  rightSha256?: string;
  changedFields: RunConfigurationField[];
  addedTools: string[];
  removedTools: string[];
  addedSkills: string[];
  removedSkills: string[];
  addedSubagents: SubagentRole[];
  removedSubagents: SubagentRole[];
}

export interface RunComparison {
  threadId: string;
  left: RunReplaySnapshot;
  right: RunReplaySnapshot;
  metricDelta: RunMetricDelta;
  outputChanged: boolean;
  eventTypeDelta: Record<string, number>;
  addedToolNames: string[];
  removedToolNames: string[];
  configurationDelta: RunConfigurationDelta;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
}

export interface EvaluationRubricSnapshot {
  name: string;
  criteria: EvaluationCriterion[];
}

export interface EvaluationCriterionScore {
  criterionId: string;
  leftScore: number;
  rightScore: number;
  reason: string;
}

export type RunEvaluationVerdict =
  | "left_better"
  | "right_better"
  | "tie"
  | "inconclusive";

export interface RunEvaluationRecord {
  id: string;
  threadId: string;
  leftRunId: string;
  rightRunId: string;
  leftSnapshotSha256: string;
  rightSnapshotSha256: string;
  rubric: EvaluationRubricSnapshot;
  scores: EvaluationCriterionScore[];
  verdict: RunEvaluationVerdict;
  reason: string;
  evidence: string;
  evaluatorModel: ModelRef;
  createdAt: string;
}

export interface CreateRunEvaluationRequest {
  leftRunId: string;
  rightRunId: string;
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
}

export interface EvaluationAdjudicationRevision {
  revision: number;
  expectedVerdict: RunEvaluationVerdict;
  note: string;
  evaluationSha256: string;
  source?: "reviewer_consensus";
  sourceSha256?: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationAdjudication {
  id: string;
  threadId: string;
  evaluationId: string;
  revisions: EvaluationAdjudicationRevision[];
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRunEvaluationRequest {
  expectedVerdict: RunEvaluationVerdict;
  note?: string;
  source?: "reviewer_consensus";
  sourceSha256?: string;
}

export interface EvaluationReviewerBallotRevision {
  revision: number;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  note: string;
  evaluationSha256: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationReviewerBallot {
  id: string;
  threadId: string;
  evaluationId: string;
  reviewerId: string;
  revisions: EvaluationReviewerBallotRevision[];
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitEvaluationReviewerBallotRequest {
  reviewerId: string;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  note?: string;
}

export interface EvaluationConsensusGate {
  minimumReviewers: number;
  minimumAgreementRate: number;
  allowInconclusive: boolean;
}

export interface EvaluationConsensusVote {
  ballotId: string;
  ballotRevision: number;
  reviewerId: string;
  reviewerName: string;
  expectedVerdict: RunEvaluationVerdict;
  ballotSha256: string;
}

export type EvaluationConsensusStatus =
  | "ready"
  | "insufficient_reviewers"
  | "no_consensus"
  | "inconclusive";

export interface EvaluationConsensusReport {
  kind: "napier.evaluation-consensus";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  evaluationId: string;
  evaluationSha256: string;
  gate: EvaluationConsensusGate;
  votes: EvaluationConsensusVote[];
  verdictCounts: Record<RunEvaluationVerdict, number>;
  reviewerCount: number;
  consensusVerdict?: RunEvaluationVerdict;
  consensusCount: number;
  agreementRate: number;
  status: EvaluationConsensusStatus;
  contentSha256: string;
}

export interface EvaluationConsensusResolution {
  id: string;
  threadId: string;
  evaluationId: string;
  evaluationSha256: string;
  report: EvaluationConsensusReport;
  adjudicationId: string;
  adjudicationRevision: EvaluationAdjudicationRevision;
  createdAt: string;
  contentSha256: string;
}

export interface ResolveEvaluationConsensusRequest {
  gate?: Partial<EvaluationConsensusGate>;
}

export interface ResolveEvaluationConsensusResult {
  report: EvaluationConsensusReport;
  resolution: EvaluationConsensusResolution;
  adjudication: EvaluationAdjudication;
  created: boolean;
}

export interface EvaluationCalibrationSample {
  evaluationId: string;
  adjudicationId: string;
  adjudicationRevision: number;
  evaluatorModel: ModelRef;
  rubricName: string;
  rubricSha256: string;
  modelVerdict: RunEvaluationVerdict;
  expectedVerdict: RunEvaluationVerdict;
  agreement: boolean;
  evaluationSha256: string;
  adjudicationSha256: string;
}

export type EvaluationConfusionMatrix = Record<
  RunEvaluationVerdict,
  Record<RunEvaluationVerdict, number>
>;

export interface EvaluationCalibrationGroup {
  evaluatorModel: ModelRef;
  rubricName: string;
  rubricSha256: string;
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  confusionMatrix: EvaluationConfusionMatrix;
}

export interface EvaluationCalibrationReport {
  kind: "napier.evaluator-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  samples: EvaluationCalibrationSample[];
  groups: EvaluationCalibrationGroup[];
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  contentSha256: string;
}

export interface EvaluationCasebookCase {
  id: string;
  casebookId: string;
  sourceThreadId: string;
  sourceEvaluationId: string;
  sourceAdjudicationId: string;
  evaluation: RunEvaluationRecord;
  adjudicationRevision: EvaluationAdjudicationRevision;
  reviewerBallots?: EvaluationReviewerBallot[];
  consensusResolution?: EvaluationConsensusResolution;
  rubricSha256: string;
  createdAt: string;
  contentSha256: string;
}

export type EvaluationCasebookRevisionSource =
  | "created"
  | "metadata_updated"
  | "case_curated"
  | "case_refreshed"
  | "case_removed";

export interface EvaluationCasebookRevision {
  revision: number;
  name: string;
  description: string;
  caseIds: string[];
  source: EvaluationCasebookRevisionSource;
  caseId?: string;
  sourceEvaluationId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface EvaluationCasebook {
  id: string;
  currentRevision: number;
  cases: EvaluationCasebookCase[];
  revisions: EvaluationCasebookRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvaluationCasebookRequest {
  threadId: string;
  name: string;
  description?: string;
}

export interface UpdateEvaluationCasebookRequest {
  threadId: string;
  name?: string;
  description?: string;
}

export interface CurateEvaluationCaseRequest {
  threadId: string;
  evaluationId: string;
}

export interface RemoveEvaluationCaseRequest {
  threadId: string;
}

export interface EvaluationCasebookCalibrationReport {
  kind: "napier.evaluation-casebook-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebookId: string;
  casebookRevision: number;
  samples: EvaluationCalibrationSample[];
  groups: EvaluationCalibrationGroup[];
  sampleCount: number;
  agreementCount: number;
  agreementRate: number;
  contentSha256: string;
}

export interface EvaluationCasebookArtifact {
  kind: "napier.evaluation-casebook";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebook: EvaluationCasebook;
  calibration: EvaluationCasebookCalibrationReport;
  contentSha256: string;
}

export interface EvaluationCasebookQualificationGate {
  minimumAgreementRate: number;
  allowInconclusive: boolean;
}

export type EvaluationCasebookEvidenceState =
  | "verified"
  | "drifted"
  | "missing";

export type EvaluationCasebookQualificationCaseStatus =
  | "agreed"
  | "disagreed"
  | "inconclusive";

export interface EvaluationCasebookQualificationCaseResult {
  caseId: string;
  sourceThreadId: string;
  sourceEvaluationId: string;
  caseSha256: string;
  evaluationSha256: string;
  rubricSha256: string;
  expectedVerdict: RunEvaluationVerdict;
  actualVerdict: RunEvaluationVerdict;
  agreement: boolean;
  evidenceState: EvaluationCasebookEvidenceState;
  reason: string;
  evidence: string;
  scores: EvaluationCriterionScore[];
  expectedLeftSnapshotSha256: string;
  expectedRightSnapshotSha256: string;
  observedLeftSnapshotSha256?: string;
  observedRightSnapshotSha256?: string;
  status: EvaluationCasebookQualificationCaseStatus;
}

export type EvaluationCasebookQualificationStatus =
  | "passed"
  | "failed"
  | "inconclusive";

export interface EvaluationCasebookQualificationExecution {
  id: string;
  casebookId: string;
  casebookRevision: number;
  casebookRevisionSha256: string;
  auditThreadId: string;
  name: string;
  evaluatorModel: ModelRef;
  gate: EvaluationCasebookQualificationGate;
  caseIds: string[];
  results: EvaluationCasebookQualificationCaseResult[];
  sampleCount: number;
  agreementCount: number;
  inconclusiveCount: number;
  unverifiedCount: number;
  agreementRate: number;
  status: EvaluationCasebookQualificationStatus;
  contentSha256: string;
  startedAt: string;
  finishedAt: string;
}

export interface ExecuteEvaluationCasebookRequest {
  threadId: string;
  model: ModelRef;
  gate?: Partial<EvaluationCasebookQualificationGate>;
}

export type EvaluationCasebookQualificationState =
  | EvaluationCasebookQualificationStatus
  | "not_run";

export interface EvaluationCasebookQualificationReceipt {
  kind: "napier.evaluation-casebook-qualification-receipt";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  casebook: EvaluationCasebook;
  state: EvaluationCasebookQualificationState;
  execution?: EvaluationCasebookQualificationExecution;
  contentSha256: string;
}

export interface EvaluationSuiteGate {
  minimumPassRate: number;
  minimumCandidateScore: number;
  allowInconclusive: boolean;
}

export interface EvaluationSuite {
  id: string;
  threadId: string;
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric: EvaluationRubricSnapshot;
  evaluatorModel: ModelRef;
  gate: EvaluationSuiteGate;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEvaluationSuiteRequest {
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
  gate?: Partial<EvaluationSuiteGate>;
}

export interface UpdateEvaluationSuiteRequest {
  name?: string;
  baselineRunId?: string;
  candidateRunIds?: string[];
  rubric?: EvaluationRubricSnapshot;
  model?: ModelRef;
  gate?: Partial<EvaluationSuiteGate>;
}

export type EvaluationSuiteCaseStatus = "passed" | "failed" | "inconclusive";

export interface EvaluationSuiteCaseResult {
  candidateRunId: string;
  evaluationId: string;
  evaluationSha256: string;
  verdict: RunEvaluationVerdict;
  baselineSnapshotSha256: string;
  candidateSnapshotSha256: string;
  baselineAverageScore?: number;
  candidateAverageScore?: number;
  status: EvaluationSuiteCaseStatus;
}

export type EvaluationSuiteExecutionStatus =
  | "passed"
  | "failed"
  | "inconclusive";

export interface EvaluationSuiteExecution {
  id: string;
  suiteId: string;
  suiteRevision: number;
  threadId: string;
  name: string;
  baselineRunId: string;
  candidateRunIds: string[];
  rubric: EvaluationRubricSnapshot;
  evaluatorModel: ModelRef;
  gate: EvaluationSuiteGate;
  results: EvaluationSuiteCaseResult[];
  passedCount: number;
  failedCount: number;
  inconclusiveCount: number;
  passRate: number;
  averageCandidateScore?: number;
  status: EvaluationSuiteExecutionStatus;
  contentSha256: string;
  startedAt: string;
  finishedAt: string;
}

export type EvaluationSuiteGateState =
  | EvaluationSuiteExecutionStatus
  | "not_run";

export interface EvaluationSuiteGateReceipt {
  kind: "napier.evaluation-gate-receipt";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  suite: EvaluationSuite;
  state: EvaluationSuiteGateState;
  evaluations: RunEvaluationRecord[];
  execution?: EvaluationSuiteExecution;
  contentSha256: string;
}

export type TrustedReceipt =
  | EvaluationSuiteGateReceipt
  | EvaluationCasebookQualificationReceipt;

export type TrustedReceiptKind = "evaluation_gate" | "casebook_qualification";

export type ReceiptTrustAnchorStatus = "trusted" | "revoked";

export type CreateReceiptTrustAnchorSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "public_key";
      publicKeySpki: string;
    };

export interface ReceiptTrustAnchor {
  id: string;
  label: string;
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  signingSource?: {
    type: "environment";
    variable: string;
  };
  status: ReceiptTrustAnchorStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  contentSha256: string;
}

export interface CreateReceiptTrustAnchorRequest {
  threadId: string;
  label: string;
  source: CreateReceiptTrustAnchorSource;
}

export interface RevokeReceiptTrustAnchorRequest {
  threadId: string;
}

export interface TrustedReceiptSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  receiptArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface TrustedReceiptEnvelope<
  Receipt extends TrustedReceipt = TrustedReceipt,
> {
  kind: "napier.trusted-receipt-envelope";
  schemaVersion: 1;
  apiVersion: string;
  receiptKind: TrustedReceiptKind;
  receipt: Receipt;
  signature: TrustedReceiptSignature;
  contentSha256: string;
}

export type TrustedReceiptVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "invalid";

export interface TrustedReceiptVerification {
  status: TrustedReceiptVerificationStatus;
  verifiedAt: string;
  receiptKind?: TrustedReceiptKind;
  receiptContentSha256?: string;
  receiptArtifactSha256?: string;
  keyId?: string;
  envelopeSha256?: string;
  signatureValid: boolean;
  integrityValid: boolean;
  reason: string;
}

export interface SignTrustedReceiptRequest {
  trustAnchorId: string;
  threadId?: string;
}

export interface VerifyTrustedReceiptRequest {
  envelope: unknown;
}

export interface EvaluationQualificationBaseline {
  id: string;
  casebookId: string;
  casebookRevision: number;
  casebookRevisionSha256: string;
  qualificationExecutionId: string;
  qualificationExecutionSha256: string;
  envelope: TrustedReceiptEnvelope<EvaluationCasebookQualificationReceipt>;
  promotedByThreadId: string;
  supersedesBaselineId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface PromoteEvaluationQualificationBaselineRequest {
  threadId: string;
  trustAnchorId: string;
}

export interface PromoteEvaluationQualificationBaselineResult {
  baseline: EvaluationQualificationBaseline;
  created: boolean;
}

export interface ThreadReplayBundle {
  kind: "napier.thread-replay";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  thread: ThreadRecord;
  agent: AgentProfile;
  agentRevisions?: AgentProfileRevision[];
  runs: RunRecord[];
  plans: ExecutionPlan[];
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications?: EvaluationAdjudication[];
  evaluationReviewerBallots?: EvaluationReviewerBallot[];
  evaluationConsensusResolutions?: EvaluationConsensusResolution[];
  evaluationSuites?: EvaluationSuite[];
  evaluationSuiteExecutions?: EvaluationSuiteExecution[];
  automaticRecoveryAssessments?: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts?: AutomaticRecoveryAttempt[];
  subagents: SubagentTask[];
  events: RunEvent[];
  eventStreamSha256: string;
  contentSha256: string;
}

export interface ImportThreadReplayBundleRequest {
  bundle: ThreadReplayBundle;
  title?: string;
}

export interface VerifyThreadReplayBundleRequest {
  bundle: ThreadReplayBundle;
}

export type ThreadReplayBundleVerificationStatus = "valid" | "invalid";

export interface ThreadReplayBundleVerification {
  status: ThreadReplayBundleVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  runCount: number;
  planCount: number;
  evaluationCount: number;
  threadId?: string;
  agentId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  source: "bundled" | "workspace" | "user";
  enabled: boolean;
}

export interface SkillPackageManifestSkill {
  name: string;
  relativePath: string;
  sizeBytes: number;
  contentSha256: string;
}

export interface SkillPackageManifest {
  kind: "napier.skill-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  requestedSkillNames: string[];
  loadedSkillNames: string[];
  missingSkillNames: string[];
  diagnosticsSha256: string;
  skillCatalogSha256: string;
  skills: SkillPackageManifestSkill[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface SkillPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedSkillPackageEnvelope {
  kind: "napier.signed-skill-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: SkillPackageManifest;
  signature: SkillPackageSignature;
  contentSha256: string;
}

export type SkillPackageVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid";

export interface SkillPackageVerification {
  status: SkillPackageVerificationStatus;
  verifiedAt: string;
  skillCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type SkillPackageQualificationStatus =
  | "qualified"
  | "catalog_drift"
  | "missing_skill"
  | SkillPackageVerificationStatus;

export interface SkillPackageQualification {
  status: SkillPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: SkillPackageVerificationStatus;
  skillCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  skillCatalogSha256?: string;
  observedSkillCatalogSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignSkillPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  skillNames?: string[];
  expiresAt?: string;
}

export interface VerifySkillPackageRequest {
  envelope: unknown;
}

export interface QualifySkillPackageRequest {
  envelope: unknown;
  threadId?: string;
}

export type SkillPackageInstallationStatus = "active" | "replaced";

export interface SkillPackageInstallation {
  id: string;
  status: SkillPackageInstallationStatus;
  publisher: string;
  keyId: string;
  loadedSkillNames: string[];
  skillCatalogSha256: string;
  manifestSha256: string;
  envelopeSha256: string;
  skillNamesSha256: string;
  installedByThreadId: string;
  installedAt: string;
  replacesInstallationId?: string;
  replacedByInstallationId?: string;
  replacedAt?: string;
  contentSha256: string;
}

export interface InstallSkillPackageRequest {
  threadId: string;
  envelope: unknown;
  replaceInstallationId?: string;
  confirmReplacement?: boolean;
  confirmPublisherChange?: boolean;
  confirmSkillSetChange?: boolean;
}

export interface InstallSkillPackageResult {
  installation: SkillPackageInstallation;
  qualification: SkillPackageQualification;
  created: boolean;
  replacedInstallation?: SkillPackageInstallation;
}

export type SkillContentReviewAction = "install" | "replace" | "noop";

export interface SkillContentReview {
  kind: "napier.skill-content-review";
  schemaVersion: 1;
  apiVersion: string;
  skillName: string;
  relativePath: string;
  action: SkillContentReviewAction;
  sizeBytes: number;
  lineCount: number;
  contentSha256: string;
  frontmatterSha256: string;
  bodySha256: string;
  currentContentSha256?: string;
  currentSizeBytes?: number;
  currentLineCount?: number;
  generatedAt: string;
  reviewSha256: string;
}

export interface PreviewSkillContentRequest {
  threadId: string;
  content: string;
}

export interface ApplySkillContentRequest {
  threadId: string;
  content: string;
  expectedReviewSha256: string;
  confirmInstall?: boolean;
  confirmReplacement?: boolean;
}

export interface ApplySkillContentResult {
  review: SkillContentReview;
  applied: boolean;
}

export interface PromptPackageManifest {
  kind: "napier.prompt-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  sourceAgentId: string;
  agentName: string;
  agentRevision: number;
  agentRevisionSha256: string;
  systemPromptSha256: string;
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface PromptPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedPromptPackageEnvelope {
  kind: "napier.signed-prompt-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: PromptPackageManifest;
  signature: PromptPackageSignature;
  contentSha256: string;
}

export type PromptPackageVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid";

export interface PromptPackageVerification {
  status: PromptPackageVerificationStatus;
  verifiedAt: string;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type PromptPackageQualificationStatus =
  | "qualified"
  | "prompt_drift"
  | "agent_missing"
  | PromptPackageVerificationStatus;

export interface PromptPackageQualification {
  status: PromptPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: PromptPackageVerificationStatus;
  manifestSha256?: string;
  envelopeSha256?: string;
  systemPromptSha256?: string;
  observedSystemPromptSha256?: string;
  sourceAgentId?: string;
  observedAgentId?: string;
  observedAgentRevision?: number;
  keyId?: string;
  reason: string;
}

export interface SignPromptPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  agentId: string;
  expiresAt?: string;
}

export interface VerifyPromptPackageRequest {
  envelope: unknown;
}

export interface QualifyPromptPackageRequest {
  envelope: unknown;
  agentId?: string;
  threadId?: string;
}

export type InspectorPanelId =
  | "trace"
  | "lab"
  | "plan"
  | "goal"
  | "memory"
  | "extensions"
  | "automations"
  | "context";

export interface InspectorPackageManifestPanel {
  id: InspectorPanelId;
  label: string;
  surface: "core" | "lazy";
  capabilities: string[];
}

export const NAPIER_DEFAULT_INSPECTOR_PANEL_ID: InspectorPanelId = "trace";

export const NAPIER_INSPECTOR_PANELS: readonly InspectorPackageManifestPanel[] =
  [
    {
      id: "trace",
      label: "Trace",
      surface: "core",
      capabilities: ["event-ledger", "otlp-export", "run-filter"],
    },
    {
      id: "lab",
      label: "Run Lab",
      surface: "core",
      capabilities: [
        "replay-snapshot",
        "run-compare",
        "fixture-transfer",
        "evaluation-suite",
        "casebook-qualification",
      ],
    },
    {
      id: "plan",
      label: "Plan",
      surface: "core",
      capabilities: ["dag-progress", "step-evidence", "artifact-manifest"],
    },
    {
      id: "goal",
      label: "Goal",
      surface: "core",
      capabilities: ["objective-state", "blocker-evidence"],
    },
    {
      id: "memory",
      label: "Memory",
      surface: "lazy",
      capabilities: ["review-lifecycle", "usage-register", "consolidation"],
    },
    {
      id: "extensions",
      label: "Extensions",
      surface: "lazy",
      capabilities: [
        "publisher-trust",
        "package-transfer",
        "tool-review",
        "rollout-channel",
      ],
    },
    {
      id: "automations",
      label: "Automations",
      surface: "lazy",
      capabilities: [
        "schedule-claims",
        "webhook-delivery",
        "recovery-attempts",
      ],
    },
    {
      id: "context",
      label: "Context",
      surface: "lazy",
      capabilities: [
        "agent-revision",
        "credential-reference",
        "prompt-package",
        "checkpoint",
      ],
    },
  ] as const;

export interface InspectorPackageManifest {
  kind: "napier.inspector-package-manifest";
  schemaVersion: 1;
  apiVersion: string;
  publisher: string;
  defaultPanelId: InspectorPanelId;
  inspectorCatalogSha256: string;
  panels: InspectorPackageManifestPanel[];
  createdAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface InspectorPackageSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  manifestArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface SignedInspectorPackageEnvelope {
  kind: "napier.signed-inspector-package";
  schemaVersion: 1;
  apiVersion: string;
  manifest: InspectorPackageManifest;
  signature: InspectorPackageSignature;
  contentSha256: string;
}

export type InspectorPackageVerificationStatus =
  | "trusted"
  | "revoked"
  | "unknown_key"
  | "expired"
  | "invalid";

export interface InspectorPackageVerification {
  status: InspectorPackageVerificationStatus;
  verifiedAt: string;
  panelCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  keyId?: string;
  reason: string;
}

export type InspectorPackageQualificationStatus =
  | "qualified"
  | "inspector_drift"
  | "missing_inspector"
  | InspectorPackageVerificationStatus;

export interface InspectorPackageQualification {
  status: InspectorPackageQualificationStatus;
  qualifiedAt: string;
  verificationStatus: InspectorPackageVerificationStatus;
  panelCount: number;
  manifestSha256?: string;
  envelopeSha256?: string;
  inspectorCatalogSha256?: string;
  observedInspectorCatalogSha256?: string;
  keyId?: string;
  reason: string;
}

export interface SignInspectorPackageRequest {
  threadId: string;
  trustAnchorId: string;
  publisher: string;
  expiresAt?: string;
}

export interface VerifyInspectorPackageRequest {
  envelope: unknown;
}

export interface QualifyInspectorPackageRequest {
  envelope: unknown;
  threadId?: string;
}

export interface ModelSummary {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  vision: boolean;
  configured: boolean;
}

export interface WorkspaceSummary {
  root: string;
  dataRoot: string;
  localFirst: true;
  isolation: "workspace";
}

export type HealthStatus = "ok" | "degraded" | "failed";

export interface HealthResponse {
  status: HealthStatus;
  service: "napier";
  time: string;
  runtime: {
    node: {
      version: string;
      platform: string;
      arch: string;
    };
    components: {
      sqlite: string;
      openssl: string;
      uv: string;
      v8: string;
    };
  };
  ledger: {
    schemaVersion: number;
    quickCheck: string;
    migrations: {
      version: number;
      name: string;
      appliedAt: string;
    }[];
  };
}

export interface BootstrapResponse {
  apiVersion: string;
  workspace: WorkspaceSummary;
  agents: AgentProfile[];
  threads: ThreadSummary[];
  skills: SkillSummary[];
  models: ModelSummary[];
  memories: MemoryFact[];
  extensions: ExtensionRecord[];
  extensionPublisherTrustAnchors: ExtensionPublisherTrustAnchor[];
  extensionPackageRolloutChannels: ExtensionPackageRolloutChannel[];
  skillPackageInstallations: SkillPackageInstallation[];
  credentials: CredentialReference[];
  usagePriceTableCatalog: UsagePriceTableCatalog;
  schedules: AutomationSchedule[];
  channels: InboundChannel[];
  inboundChannelAdapters: InboundChannelAdapterDescriptor[];
  inboundChannelAdapterCatalogSha256: string;
  activeThread?: ThreadDetail;
}

export interface ThreadDetail {
  thread: ThreadRecord;
  agent: AgentProfile;
  runs: RunRecord[];
  plans: ExecutionPlan[];
  evaluations: RunEvaluationRecord[];
  evaluationAdjudications: EvaluationAdjudication[];
  evaluationReviewerBallots: EvaluationReviewerBallot[];
  evaluationConsensusResolutions: EvaluationConsensusResolution[];
  evaluationSuites: EvaluationSuite[];
  evaluationSuiteExecutions: EvaluationSuiteExecution[];
  automaticRecoveryAssessments: AutomaticRecoveryAssessment[];
  automaticRecoveryAttempts: AutomaticRecoveryAttempt[];
  subagents: SubagentTask[];
  contextCheckpointCalibration: ContextCheckpointCalibrationReport;
  events: RunEvent[];
}

export interface CreateThreadRequest {
  title?: string;
  agentId?: string;
}

export interface PromptRequest {
  text: string;
  model?: ModelRef;
}

export interface ResumeRunRequest {
  runId?: string;
  model?: ModelRef;
}

export interface SetGoalRequest {
  objective: string;
  maxContinuations?: number;
}

export interface CreateBranchRequest {
  fromSeq: number;
  title?: string;
}

export type StreamFrame =
  | { type: "event"; event: RunEvent; eventSha256: string }
  | { type: "snapshot"; detail: ThreadDetail; detailSha256: string }
  | {
      type: "error";
      threadId: string;
      message: string;
      code: "run_failed";
      diagnosticSha256: string;
    }
  | {
      type: "done";
      threadId: string;
      runId: string;
      status: TerminalRunStatus;
      snapshotSha256: string;
      eventCount: number;
      eventStreamSha256: string;
    };

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}
