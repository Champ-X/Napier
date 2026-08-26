import type { JsonPrimitive } from "./run-event-v1.js";

export * from "./run-event-v1.js";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type TerminalRunStatus = Exclude<RunStatus, "queued" | "running">;

export type RunInvocationSource =
  | "user"
  | "recovery"
  | "schedule"
  | "channel"
  | "workflow"
  | "workflow_reuse"
  | "workflow_simulation"
  | "model_experiment"
  | "tool_experiment";

export interface Usage extends Record<string, JsonPrimitive> {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export type ModelAdvisorRuleId =
  | "unverified_verification_claim"
  | "destructive_command_reference";

export type ModelAdvisorMode = "observe" | "enforce" | "off";

export interface LegacyModelAdvisorPolicy {
  mode: ModelAdvisorMode;
  enabledRules: ModelAdvisorRuleId[];
}

export interface ModelAdvisorPolicy extends LegacyModelAdvisorPolicy {
  maxCorrectionAttempts?: number;
  reviewModel?: ModelRef;
}

export interface ResolvedModelAdvisorPolicy extends ModelAdvisorPolicy {
  maxCorrectionAttempts: number;
}

export interface LegacyResolvedModelAdvisorPolicy extends LegacyModelAdvisorPolicy {
  maxCorrectionAttempts: number;
}

export interface ToolLoopGuardPolicy {
  enabled: boolean;
  threshold: number;
  exemptTools: string[];
}

export interface ModelRef {
  provider: string;
  id: string;
}

export type ToolPolicyMode = "observe" | "workspace" | "unrestricted";

export type SubagentRole = "researcher" | "reviewer" | "general" | "coder";

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

export type RunExecutionMode =
  | "standard"
  | "environment_degraded_read_only"
  | "safe_read_only_recovery"
  | "workflow_map_read_only"
  | "workflow_loop_read_only"
  | "agent_experiment_read_only"
  | "model_experiment_single_call"
  | "tool_experiment_read_only";

export type McpToolEffect = "read" | "write" | "unknown";

export type OperatorDecisionStatus =
  | "pending"
  | "answered"
  | "continued"
  | "cancelled";

export type OperatorDecisionCancellationReason =
  | "operator_cancelled"
  | "workflow_timed_out"
  | "run_completed_without_wait"
  | "run_failed"
  | "run_cancelled";

export interface OperatorDecisionOption {
  id: string;
  label: string;
  description: string;
}

export interface AnswerOperatorDecisionRequest {
  selectedOptionIds: string[];
  customText?: string;
}

export interface OperatorDecision {
  kind: "napier.operator-decision";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  status: OperatorDecisionStatus;
  header: string;
  question: string;
  options: OperatorDecisionOption[];
  multiSelect: boolean;
  questionSha256: string;
  requestedAt: string;
  requestedEventSeq: number;
  answeredAt?: string;
  answeredEventSeq?: number;
  selectedOptionIds?: string[];
  customText?: string;
  answerSha256?: string;
  continuedAt?: string;
  continuedEventSeq?: number;
  continuationRunId?: string;
  cancelledAt?: string;
  cancellationEventSeq?: number;
  cancellationReason?: OperatorDecisionCancellationReason;
  contentSha256: string;
}
