import type { RunExecutionMode } from "@napier/contracts";

export const TOOL_INVOCATION_EXPERIMENT_EXECUTION: unique symbol = Symbol(
  "napier.tool-invocation-experiment-execution",
);

export interface ToolInvocationExperimentExecution {
  sourceThreadId: string;
  sourceRunId: string;
  sourceAgentRevision: number;
  sourceCallId: string;
  sourceCapsuleEventSeq: number;
  sourceStartedEventSeq: number;
  sourceTerminalEventSeq: number;
  sourceToolName: string;
  sourceToolDefinitionSha256: string;
  sourceArgumentsSha256: string;
  sourceWorkspaceScopeSha256: string;
  sourceCapsuleSha256: string;
  candidateWorkspaceSnapshotSha256: string;
  executionMode: Extract<RunExecutionMode, "tool_experiment_read_only">;
  previewSha256: string;
}
