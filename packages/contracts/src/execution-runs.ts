import type {
  AutomaticRecoveryPolicy,
  LegacyModelAdvisorPolicy,
  LegacyResolvedModelAdvisorPolicy,
  ModelAdvisorPolicy,
  ModelRef,
  ResolvedModelAdvisorPolicy,
  RunExecutionMode,
  RunInvocationSource,
  RunLimits,
  RunStatus,
  SubagentLimits,
  SubagentRole,
  ToolLoopGuardPolicy,
  ToolPolicyMode,
  Usage,
} from "./execution-core.js";

export type PromptVariableDateFormat =
  | "readable-date"
  | "iso-date"
  | "local-date-time";

export interface LiteralPromptVariableDefinition {
  name: string;
  type: "literal";
  value: string;
}

export interface CurrentDatePromptVariableDefinition {
  name: string;
  type: "current_date";
  format: PromptVariableDateFormat;
}

export interface SkillCatalogPromptVariableDefinition {
  name: string;
  type: "skill_catalog";
}

export type PromptVariableDefinition =
  | LiteralPromptVariableDefinition
  | CurrentDatePromptVariableDefinition
  | SkillCatalogPromptVariableDefinition;

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
  modelAdvisor?: ModelAdvisorPolicy;
  promptVariables?: PromptVariableDefinition[];
  toolLoopGuard?: ToolLoopGuardPolicy;
  revision: number;
  createdAt: string;
  updatedAt: string;
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

export interface RunConfigurationFingerprintV4 extends RunConfigurationFingerprintBase {
  schemaVersion: 4;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
  modelAdvisor: LegacyModelAdvisorPolicy;
}

export interface RunConfigurationFingerprintV5 extends RunConfigurationFingerprintBase {
  schemaVersion: 5;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
  modelAdvisor: LegacyResolvedModelAdvisorPolicy;
}

export interface RunConfigurationFingerprintV6 extends RunConfigurationFingerprintBase {
  schemaVersion: 6;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
  modelAdvisor: ResolvedModelAdvisorPolicy;
}

export interface RunConfigurationFingerprintV7 extends RunConfigurationFingerprintBase {
  schemaVersion: 7;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
  modelAdvisor: ResolvedModelAdvisorPolicy;
  promptVariableCatalogSha256: string;
  promptVariableSnapshotSha256: string;
  resolvedSystemPromptSha256: string;
}

export interface RunConfigurationFingerprintV8 extends RunConfigurationFingerprintBase {
  schemaVersion: 8;
  automaticRecovery: AutomaticRecoveryPolicy;
  executionMode: RunExecutionMode;
  skillCatalogSha256: string;
  modelAdvisor: ResolvedModelAdvisorPolicy;
  promptVariableCatalogSha256: string;
  promptVariableSnapshotSha256: string;
  resolvedSystemPromptSha256: string;
  toolLoopGuard: ToolLoopGuardPolicy;
}

export type RunConfigurationFingerprint =
  | RunConfigurationFingerprintV1
  | RunConfigurationFingerprintV2
  | RunConfigurationFingerprintV3
  | RunConfigurationFingerprintV4
  | RunConfigurationFingerprintV5
  | RunConfigurationFingerprintV6
  | RunConfigurationFingerprintV7
  | RunConfigurationFingerprintV8;

type RunOutcome =
  | "completed"
  | "partial"
  | "paused_budget"
  | "blocked_capability"
  | "blocked_safety"
  | "cancelled"
  | "failed_unrecoverable";

export interface RunRecord {
  id: string;
  threadId: string;
  agentId: string;
  status: RunStatus;
  outcome?: RunOutcome;
  source?: RunInvocationSource;
  workflowPlanId?: string;
  triggerId?: string;
  releaseIdentitySha256?: string;
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

export interface RunMetrics {
  durationMs: number;
  eventCount: number;
  messageCount: number;
  modelResponseCount: number;
  modelContextEnvelopeCount: number;
  embeddedModelContextEnvelopeCount: number;
  modelContextBoundResponseCount: number;
  modelContextUnboundResponseCount: number;
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
  | "modelAdvisor"
  | "executionMode"
  | "skillCatalog"
  | "promptVariables"
  | "toolLoopGuard";

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
