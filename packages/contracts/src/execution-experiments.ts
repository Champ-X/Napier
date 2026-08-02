import type {
  ModelRef,
  RunExecutionMode,
  TerminalRunStatus,
  Usage,
} from "./execution-core.js";
import type {
  RunConfigurationDelta,
  RunMetricDelta,
  RunMetrics,
} from "./execution-runs.js";

export interface AgentMessageExperimentToolEffects {
  toolCallCount: number;
  readOnlyCount: number;
  writeCount: number;
  unknownCount: number;
  unresolvedCount: number;
  writeToolNames: string[];
  unknownToolNames: string[];
}

export type AgentMessageExperimentToolResultMode = "live" | "reuse_source";

export interface CreateAgentMessageExperimentRequest {
  sourceRunId: string;
  sourceMessageSeq: number;
  model?: ModelRef;
  title?: string;
  toolResultMode?: AgentMessageExperimentToolResultMode;
  expectedPreviewSha256?: string;
}

export interface AgentMessageExperimentPreview {
  kind: "napier.agent-message-experiment-preview";
  schemaVersion: 2;
  sourceThreadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  branchFromSeq: number;
  sourceAgentId: string;
  sourceAgentRevision: number;
  sourceRunConfigurationSha256: string;
  sourcePromptVariableResolvedAt: string;
  sourcePromptSha256: string;
  sourceHistorySha256: string;
  sourceHistoryMessageCount: number;
  sourceMemoryContextSha256: string;
  sourceSkillCatalogSha256: string;
  candidateWorkspaceSnapshotSha256: string;
  candidateWorkspaceFileCount: number;
  candidateWorkspaceBytes: number;
  sourceModel: ModelRef;
  targetModel: ModelRef;
  targetExecutionMode: "agent_experiment_read_only";
  targetToolNames: string[];
  sourceToolEffects: AgentMessageExperimentToolEffects;
  toolResultMode: AgentMessageExperimentToolResultMode;
  sourceReusableToolResultCount: number;
  sourceToolResultSetSha256: string;
  previewSha256: string;
}

export interface AgentMessageExperimentRunObservation {
  threadId: string;
  runId: string;
  status: TerminalRunStatus;
  configurationSha256: string;
  model: ModelRef;
  executionMode: RunExecutionMode;
  metrics: RunMetrics;
  toolNames: string[];
  toolEffects: AgentMessageExperimentToolEffects;
}

export interface AgentMessageExperimentComparison {
  kind: "napier.agent-message-experiment-comparison";
  schemaVersion: 1;
  source: AgentMessageExperimentRunObservation;
  target: AgentMessageExperimentRunObservation;
  metricDelta: RunMetricDelta;
  outputChanged: boolean;
  addedToolNames: string[];
  removedToolNames: string[];
  configurationDelta: RunConfigurationDelta;
  contentSha256: string;
}

export interface AgentMessageExperimentResult {
  kind: "napier.agent-message-experiment-result";
  schemaVersion: 2;
  preview: AgentMessageExperimentPreview;
  targetThreadId: string;
  targetRunId: string;
  status: TerminalRunStatus;
  assistantText?: string;
  toolResultReuse: AgentMessageExperimentToolResultReuse;
  comparison: AgentMessageExperimentComparison;
}

export interface AgentMessageExperimentToolResultReuse {
  mode: AgentMessageExperimentToolResultMode;
  sourceResultCount: number;
  reusedResultCount: number;
  divergenceCount: number;
  complete: boolean;
  sourceResultSetSha256: string;
  targetReuseSetSha256: string;
}

export type ModelInvocationPurpose =
  | "agent_turn"
  | "context_compaction"
  | "goal_evaluation"
  | "memory_extraction";

export interface CreateModelInvocationExperimentRequest {
  sourceRunId: string;
  sourceTurnIndex: number;
  model?: ModelRef;
  title?: string;
  expectedPreviewSha256?: string;
}

export interface ModelInvocationExperimentPreview {
  kind: "napier.model-invocation-experiment-preview";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  sourceAgentId: string;
  sourceAgentRevision: number;
  sourceTurnIndex: number;
  sourceCapsuleEventSeq: number;
  sourceResponseEventSeq: number;
  purpose: ModelInvocationPurpose;
  sourceModel: ModelRef;
  targetModel: ModelRef;
  sourceContextEnvelopeSha256: string;
  sourceContextSha256: string;
  sourceCapsuleSha256: string;
  sourceCapsuleBytes: number;
  sourceMessageCount: number;
  sourceToolCount: number;
  sourceOutputSha256: string;
  sourceTextSha256: string;
  sourceStopReason: string;
  targetExecutionMode: "model_experiment_single_call";
  previewSha256: string;
}

export type ModelInvocationExperimentStatus =
  | "completed"
  | "failed"
  | "cancelled";

export interface ModelInvocationExperimentObservation {
  threadId: string;
  runId: string;
  status: ModelInvocationExperimentStatus;
  model: ModelRef;
  stopReason: string;
  durationMs: number;
  usage: Usage;
  textSha256: string;
  outputSha256: string;
  toolCallCount: number;
  toolNames: string[];
}

export interface ModelInvocationExperimentMetricDelta {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  toolCallCount: number;
}

export interface ModelInvocationExperimentComparison {
  kind: "napier.model-invocation-experiment-comparison";
  schemaVersion: 1;
  source: ModelInvocationExperimentObservation;
  target: ModelInvocationExperimentObservation;
  metricDelta: ModelInvocationExperimentMetricDelta;
  outputChanged: boolean;
  textChanged: boolean;
  addedToolNames: string[];
  removedToolNames: string[];
  contentSha256: string;
}

export interface ModelInvocationExperimentResult {
  kind: "napier.model-invocation-experiment-result";
  schemaVersion: 1;
  preview: ModelInvocationExperimentPreview;
  targetThreadId: string;
  targetRunId: string;
  status: ModelInvocationExperimentStatus;
  assistantText?: string;
  candidateToolCallNames: string[];
  comparison: ModelInvocationExperimentComparison;
}

export interface CreateToolInvocationExperimentRequest {
  sourceRunId: string;
  sourceCallId: string;
  title?: string;
  expectedPreviewSha256?: string;
}

export interface ToolInvocationExperimentPreview {
  kind: "napier.tool-invocation-experiment-preview";
  schemaVersion: 1;
  sourceThreadId: string;
  sourceRunId: string;
  sourceAgentId: string;
  sourceAgentRevision: number;
  sourceCallId: string;
  sourceCapsuleEventSeq: number;
  sourceStartedEventSeq: number;
  sourceTerminalEventSeq: number;
  sourceToolName: string;
  sourceEffect: "read";
  sourceToolDefinitionSha256: string;
  sourceArgumentsSha256: string;
  sourceWorkspaceScopeSha256: string;
  sourceCapsuleSha256: string;
  sourceCapsuleBytes: number;
  sourceDurationMs: number;
  sourceOutputSha256: string;
  sourceOutputBytes: number;
  candidateWorkspaceSnapshotSha256: string;
  candidateWorkspaceFileCount: number;
  candidateWorkspaceBytes: number;
  targetExecutionMode: "tool_experiment_read_only";
  previewSha256: string;
}

export type ToolInvocationExperimentStatus =
  | "completed"
  | "failed"
  | "cancelled";

export interface ToolInvocationExperimentObservation {
  threadId: string;
  runId: string;
  status: ToolInvocationExperimentStatus;
  toolName: string;
  durationMs: number;
  outputSha256: string;
  outputBytes: number;
}

export interface ToolInvocationExperimentComparison {
  kind: "napier.tool-invocation-experiment-comparison";
  schemaVersion: 1;
  source: ToolInvocationExperimentObservation;
  target: ToolInvocationExperimentObservation;
  durationMsDelta: number;
  outputChanged: boolean;
  contentSha256: string;
}

export interface ToolInvocationExperimentResult {
  kind: "napier.tool-invocation-experiment-result";
  schemaVersion: 1;
  preview: ToolInvocationExperimentPreview;
  targetThreadId: string;
  targetRunId: string;
  status: ToolInvocationExperimentStatus;
  candidateOutput?: string;
  comparison: ToolInvocationExperimentComparison;
}
