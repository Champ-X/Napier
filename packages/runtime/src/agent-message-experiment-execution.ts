export const AGENT_MESSAGE_EXPERIMENT_EXECUTION: unique symbol = Symbol(
  "napier.agent-message-experiment-execution",
);

export interface AgentMessageExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  sourceRunConfigurationSha256: string;
  sourcePromptVariableResolvedAt: string;
  previewSha256: string;
  sourcePromptSha256: string;
  candidateWorkspaceSnapshotSha256: string;
  toolResultMode: "live" | "reuse_source";
  sourceReusableToolResultCount: number;
  sourceToolResultSetSha256: string;
}
