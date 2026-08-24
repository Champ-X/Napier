import type { JsonPrimitive, JsonValue, McpToolEffect, ModelAdvisorRuleId, ModelRef, ResolvedModelAdvisorPolicy, Usage } from "./execution-core.js";
import type { ModelContextEnvelopeReceipt } from "./model-context-envelope.js";

export const NAPIER_API_VERSION = "2026-07-25";

export type ThreadStatus = "idle" | "running" | "waiting" | "failed";

export type GoalStatus = "active" | "completed" | "blocked";

export type GoalBlocker = "none" | "missing_evidence" | "needs_user_input" | "run_failed" | "external_wait" | "goal_not_met_yet";

export type UsageAccountingStrategy = "demo_estimate" | "provider_reported" | "openai_cache_discounted" | "deepseek_cache_discounted" | "anthropic_cache_discounted" | "google_cache_discounted";

export type UsageCostAccountingStrategy = "zero_cost" | "provider_reported_cost" | "price_table_estimate";

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

export type UsagePriceTableVerificationStatus = "valid" | "invalid" | "provider_missing";

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

export type ModelAdvisorSeverity = "warning" | "blocker";

export type IndependentModelAdvisorIssueCode = "instruction_following" | "correctness" | "evidence" | "safety" | "scope" | "regression";

export type ModelAdvisorBlockerId = ModelAdvisorRuleId | `independent_review:${IndependentModelAdvisorIssueCode}` | "independent_review:inconclusive";

export type IndependentModelAdvisorVerdict = "accept" | "revise" | "block" | "inconclusive";

export type IndependentModelAdvisorRisk = "low" | "medium" | "high";

export interface IndependentModelAdvisorIssue {
  code: IndependentModelAdvisorIssueCode;
  severity: ModelAdvisorSeverity;
  guidanceSha256: string;
}

export interface IndependentModelAdvisorEvidenceSummary {
  eventCount: number;
  toolCompletedNameCount: number;
  toolFailedNameCount: number;
  verificationToolCompleted: boolean;
  verificationToolPassed: boolean;
  workspaceWriteCompleted: boolean;
  verificationToolPassedAfterWorkspaceWrite: boolean;
  planCompleted: boolean;
  planArtifactVerified: boolean;
  goalSatisfied: boolean;
  recoveryCompleted: boolean;
  evaluationCompleted: boolean;
  evaluationPassed: boolean;
  planCompletedAfterWorkspaceWrite: boolean;
  planArtifactVerifiedAfterWorkspaceWrite: boolean;
  goalSatisfiedAfterWorkspaceWrite: boolean;
  recoveryCompletedAfterInterruption: boolean;
  evaluationCompletedAfterWorkspaceWrite: boolean;
  evaluationPassedAfterWorkspaceWrite: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
  latestPlanCompletedSeq?: number;
  latestPlanInvalidatedSeq?: number;
  latestPlanArtifactVerifiedSeq?: number;
  latestPlanArtifactInvalidatedSeq?: number;
  latestGoalSatisfiedSeq?: number;
  latestGoalInvalidatedSeq?: number;
  latestRecoveryCompletedSeq?: number;
  latestRunInterruptedSeq?: number;
  latestRecoveryInvalidatedSeq?: number;
  latestEvaluationCompletedSeq?: number;
  latestEvaluationPassedSeq?: number;
  latestEvaluationPassInvalidatedSeq?: number;
  milestoneCount: number;
  operatorDecisionRequested: boolean;
}

export interface IndependentModelAdvisorReview {
  kind: "napier.independent-model-advisor-review";
  schemaVersion: 1;
  policyId: "napier.independent-model-advisor.v1";
  turnSource: string;
  candidateModel: ModelRef;
  reviewerModel: ModelRef;
  verdict: IndependentModelAdvisorVerdict;
  score: number;
  risk: IndependentModelAdvisorRisk;
  issues: IndependentModelAdvisorIssue[];
  diagnosticCodes: string[];
  candidateTextSha256: string;
  candidateTextBytes: number;
  turnPromptSha256: string;
  evidenceSha256: string;
  evidenceSummary?: IndependentModelAdvisorEvidenceSummary;
  criteriaSha256: string;
  inputSha256: string;
  promptSha256: string;
  responseSha256: string;
  reviewSchemaSha256: string;
  issueSetSha256: string;
  usage: Usage;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
  contentSha256: string;
}

export interface ModelAdvisorDiagnostic {
  ruleId: ModelAdvisorRuleId;
  severity: ModelAdvisorSeverity;
  matchCount: number;
  evidenceSha256: string;
}

export interface ModelAdvisorEvidence {
  assistantTextBytes: number;
  assistantLineCount: number;
  toolCompletedCount: number;
  verificationToolCompleted: boolean;
  verificationToolPassed: boolean;
  workspaceWriteCompleted: boolean;
  verificationToolPassedAfterWorkspaceWrite: boolean;
  planCompleted: boolean;
  planArtifactVerified: boolean;
  goalSatisfied: boolean;
  recoveryCompleted: boolean;
  evaluationCompleted: boolean;
  evaluationPassed: boolean;
  planCompletedAfterWorkspaceWrite: boolean;
  planArtifactVerifiedAfterWorkspaceWrite: boolean;
  goalSatisfiedAfterWorkspaceWrite: boolean;
  recoveryCompletedAfterInterruption: boolean;
  evaluationCompletedAfterWorkspaceWrite: boolean;
  evaluationPassedAfterWorkspaceWrite: boolean;
  latestWorkspaceWriteSeq?: number;
  latestPassedVerificationSeq?: number;
  latestPlanCompletedSeq?: number;
  latestPlanInvalidatedSeq?: number;
  latestPlanArtifactVerifiedSeq?: number;
  latestPlanArtifactInvalidatedSeq?: number;
  latestGoalSatisfiedSeq?: number;
  latestGoalInvalidatedSeq?: number;
  latestRecoveryCompletedSeq?: number;
  latestRunInterruptedSeq?: number;
  latestRecoveryInvalidatedSeq?: number;
  latestEvaluationCompletedSeq?: number;
  latestEvaluationPassedSeq?: number;
  latestEvaluationPassInvalidatedSeq?: number;
}

export interface ModelAdvisorNoticePayload {
  kind: "napier.model-advisor-notice";
  schemaVersion: 1;
  source: "deterministic_stream_lint";
  turnSource: string;
  policy: ResolvedModelAdvisorPolicy;
  status: "notice" | "blocked";
  textSha256: string;
  diagnosticCount: number;
  diagnosticSetSha256: string;
  diagnostics: ModelAdvisorDiagnostic[];
  evidence: ModelAdvisorEvidence;
  contentSha256: string;
}

export interface ToolLoopGuardContextReceipt {
  kind: "napier.tool-loop-guard-context";
  schemaVersion: 1;
  enabled: boolean;
  threshold: number;
  exemptToolCount: number;
  exemptToolSetSha256: string;
  policySha256: string;
  contentSha256: string;
}

export interface ToolLoopGuardTriggerReceipt {
  kind: "napier.tool-loop-guard-trigger";
  schemaVersion: 1;
  toolName: string;
  threshold: number;
  attemptCount: number;
  fromSeq: number;
  toSeq: number;
  callSha256: string;
  resultSha256: string;
  attemptSetSha256: string;
  policySha256: string;
  contentSha256: string;
}

export interface ModelAdvisorCorrectionRequestPayload {
  kind: "napier.model-advisor-correction-request";
  schemaVersion: 1;
  source: "deterministic_stream_lint" | "combined_advisor";
  turnSource: string;
  attempt: number;
  maxAttempts: number;
  predecessorTextSha256: string;
  diagnosticSetSha256: string;
  blockerRuleIds: ModelAdvisorBlockerId[];
  correctivePromptSha256: string;
  contentSha256: string;
}

export interface ModelAdvisorCorrectionOutcomePayload {
  kind: "napier.model-advisor-correction-outcome";
  schemaVersion: 1;
  source: "deterministic_stream_lint" | "combined_advisor";
  status: "accepted" | "blocked" | "exhausted";
  attempt: number;
  maxAttempts: number;
  requestContentSha256: string;
  responseTextSha256: string;
  diagnosticSetSha256?: string;
  contentSha256: string;
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
