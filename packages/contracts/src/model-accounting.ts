import type { Usage } from "./execution-core.js";
import type { ModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { UsagePriceTable } from "./protocol-v1-core.js";

export type ModelCallMethod =
  | "stream"
  | "streamSimple"
  | "complete"
  | "completeSimple";
export type ModelAccountingPhase =
  | "agent_turn"
  | "subagent_turn"
  | "typed_repair"
  | "outcome_repair"
  | "context_compaction"
  | "goal_evaluation"
  | "memory_extraction"
  | "thread_title"
  | "independent_model_advisor"
  | "context_compaction_preview"
  | "model_experiment"
  | "evaluation_judgment"
  | "replan_review"
  | "blueprint_outcome_review"
  | "subagent_outcome_review"
  | "standalone_model_call";
export type ModelUsageOwner =
  | { kind: "run"; threadId: string; runId: string }
  | {
      kind: "child";
      threadId: string;
      runId: string;
      parentRunId: string;
      taskId: string;
      executionId: string;
      childInvocationId: string;
      invocationIndex: number;
    }
  | { kind: "operation"; operationId: string; operation: ModelAccountingPhase };

export interface ModelAdapterReceiptV2 {
  kind: "napier.model-adapter-selection";
  schemaVersion: 2;
  adapterId:
    | "napier.anthropic-messages.v2"
    | "napier.openai-family.v2"
    | "napier.generic.v2";
  family: "anthropic" | "openai" | "generic";
  adapterVersion: 2;
  modelApi: string;
  cacheRetention: "none" | "short" | "long" | "provider_default";
  cacheRetentionSource: "caller" | "adapter" | "provider_default";
  streamOptionMaxTokens: number;
  streamOptionMaxTokensSource:
    | "caller"
    | "caller_clamped_to_model"
    | "adapter"
    | "model";
  modelMaxTokens: number;
  contentSha256: string;
}

export interface ModelCallCaptureBinding {
  envelope: ModelContextEnvelopeReceipt;
  adapter: ModelAdapterReceiptV2;
  contextSha256: string;
  generationOptionsSha256: string;
  admittedModelSha256: string;
  requestSha256: string;
  requestScope: "admitted_input_v1";
  privateCapsule:
    | { status: "available"; receiptSha256: string; capsuleSha256: string }
    | { status: "unavailable"; reason: "limit" | "storage" | "invalid" }
    | { status: "not_requested" };
}

export interface ModelProviderPriceTableV1 {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers?: Array<{
    inputTokensAbove: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  }>;
}
export interface FrozenModelAccountingBasisV1 {
  schemaVersion: 1;
  normalizationPolicy: "napier.provider-usage.v1";
  providerPriceTable: ModelProviderPriceTableV1 | null;
  runPriceTable: UsagePriceTable | null;
  runTokenWeights: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  declaredZeroCost: boolean;
  contentSha256: string;
}
export interface ModelCallAttributionV1 {
  kind: "napier.model-call-attribution";
  schemaVersion: 1;
  /** One admitted Models invocation, not one hidden HTTP retry or provider invoice item. */
  physicalId: string;
  workspaceLedgerId: string;
  receiptSourceId: string;
  hostWorkspaceId?: string;
  owner: ModelUsageOwner;
  phase: ModelAccountingPhase;
  method: ModelCallMethod;
  logicalCallId: string;
  model: { provider: string; id: string; api: string };
  route?: {
    planId: string;
    attempt: number;
    stepAttempt: number;
    startedEventSeq: number;
    candidateSha256: string;
  };
  recovery?: { thinkingAttempt: number; contextOverflowAttempt: 0 | 1 };
  capture: ModelCallCaptureBinding;
  accountingBasis: FrozenModelAccountingBasisV1;
  createdAt: string;
  contentSha256: string;
}
export interface ValidatedProviderUsageComponentsV1 {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  totalTokens: number | null;
  reasoning: number | null;
  cacheWrite1h: number | null;
  cost: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    total: number | null;
  };
}
export type ModelUsageDiagnosticCode =
  | "usage_missing"
  | "tokens_missing"
  | "tokens_invalid"
  | "tokens_inconsistent"
  | "subset_invalid"
  | "cost_missing"
  | "cost_invalid"
  | "cost_inconsistent"
  | "model_mismatch"
  | "terminal_unconfirmed"
  | "provider_zero_unconfirmed"
  | "response_unhashable";
export interface ModelPhysicalObservationV1 {
  schemaVersion: 1;
  physicalId: string;
  attributionSha256: string;
  observationScope: "admitted_provider_invocation";
  terminal: "response" | "rejected" | "undispatched";
  stopReason: string | null;
  usageStatus: "known" | "partial" | "unknown" | "known_zero_undispatched";
  usage: ValidatedProviderUsageComponentsV1;
  responseSha256: string | null;
  diagnosticCodes: ModelUsageDiagnosticCode[];
  observedAt: string;
  contentSha256: string;
}
export type ModelUsageCompleteness = "complete" | "incomplete";
export interface ModelObservationUsageProjection {
  /** Valid nonnegative component subtotal; incomplete counters remain incomplete. */
  usage: Usage;
  tokenCompleteness: ModelUsageCompleteness;
  reportedCostCompleteness: ModelUsageCompleteness;
  budgetCostCompleteness: ModelUsageCompleteness;
  budgetTokens: number;
  budgetCostUsd: number | null;
}
export interface ModelAccountingSummaryV1 {
  schemaVersion: 1;
  mode: "physical_receipt_v1";
  revision: number;
  usageStatus: ModelUsageCompleteness;
  tokenCompleteness: ModelUsageCompleteness;
  reportedCostCompleteness: ModelUsageCompleteness;
  budgetCostCompleteness: ModelUsageCompleteness;
  unresolvedInvocations: number;
  partialInvocations: number;
  budgetTokens: number;
  budgetCostUsd: number | null;
  /** Retained priced subtotal even when another invocation has unknown cost. */
  knownBudgetCostUsd: number;
  evidenceSha256: string;
}
