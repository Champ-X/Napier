import type { AutomaticRecoveryPolicy, ModelAdvisorPolicy, ModelRef, RunLimits, SubagentLimits, SubagentRole, ToolLoopGuardPolicy, ToolPolicyMode } from "./execution-core.js";
import type { AgentProfile, PromptVariableDefinition } from "./execution-runs.js";
import type { ModelRoutePolicyV2 } from "./model-route.js";
import type { GoalState, ThreadStatus } from "./protocol-v1-core.js";

export type AgentProfileField = "name" | "description" | "systemPrompt" | "model" | "thinkingLevel" | "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents" | "subagentLimits" | "runLimits" | "automaticRecovery" | "modelAdvisor" | "promptVariables" | "toolLoopGuard" | "modelRoute";

export type AgentProfileRevisionSource = "created" | "updated" | "rollback" | "imported" | "migrated";

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
  modelAdvisor?: ModelAdvisorPolicy;
  promptVariables?: PromptVariableDefinition[];
  toolLoopGuard?: ToolLoopGuardPolicy;
  modelRoute?: ModelRoutePolicyV2;
  clearModelRoute?: true;
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
  localImportedThroughSeq?: number;
  sourceModelContextEnvelopeCount?: number;
  sourceEmbeddedModelContextEnvelopeCount?: number;
  importedAt: string;
}

export interface ThreadRecord extends ThreadSummary {
  currentRunId?: string;
  runIds: string[];
  importProvenance?: ThreadImportProvenance;
}

export type AutomaticRecoveryBlockReason =
  | "configuration_missing"
  | "legacy_configuration"
  | "policy_manual"
  | "run_not_interrupted"
  | "workflow_managed"
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

export type AutomaticRecoveryAttemptStatus = "claimed" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "abandoned";

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

export type RunControlMessageMode = "steering" | "follow_up";

export type RunControlMessageStatus = "queued" | "delivered" | "cancelled";

export type RunControlMessageCancellationReason = "operator_cancelled" | "run_completed_before_delivery" | "run_failed_before_delivery" | "run_cancelled_before_delivery" | "run_interrupted_before_delivery";

export interface QueueRunControlMessageRequest {
  mode: RunControlMessageMode;
  text: string;
}

export interface RunControlMessage {
  kind: "napier.run-control-message";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  mode: RunControlMessageMode;
  status: RunControlMessageStatus;
  textSha256: string;
  textBytes: number;
  queuedAt: string;
  queuedEventSeq: number;
  deliveredAt?: string;
  deliveredEventSeq?: number;
  messageEventSeq?: number;
  cancelledAt?: string;
  cancellationEventSeq?: number;
  cancellationReason?: RunControlMessageCancellationReason;
  contentSha256: string;
}
