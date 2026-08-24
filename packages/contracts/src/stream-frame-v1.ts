import type { OperatorDecision, RunEvent, TerminalRunStatus, Usage } from "./execution-core.js";
import type { AgentMessageExperimentResult, ModelInvocationExperimentResult, ModelInvocationExperimentStatus, ToolInvocationExperimentResult, ToolInvocationExperimentStatus } from "./execution-experiments.js";
import type { ExecutionPlanWorkflowResult, ExecutionPlanWorkflowStatus } from "./execution-workflows.js";
import type { ExecutionPlanWorkflowExperimentResult } from "./workflow-experiments.js";
import type { ThreadDetail } from "./workspace-bootstrap-v1.js";

export type StreamFrame =
  | {
      type: "event";
      event: RunEvent;
      eventSha256: string;
      projections?: {
        taskNarrative?: NonNullable<ThreadDetail["taskNarrative"]>;
        activePlan?: NonNullable<ThreadDetail["activePlan"]>;
        messages?: NonNullable<ThreadDetail["messages"]>;
        artifacts?: NonNullable<ThreadDetail["artifacts"]>;
        activityEvents?: NonNullable<ThreadDetail["activityEvents"]>;
        citations?: NonNullable<ThreadDetail["citations"]>;
        recoveries?: NonNullable<ThreadDetail["recoveries"]>;
        subagentCards?: NonNullable<ThreadDetail["subagentCards"]>;
        activityCandidates?: NonNullable<ThreadDetail["activityCandidates"]>;
        conversationPlans?: NonNullable<ThreadDetail["conversationPlans"]>;
        operatorDecisions?: OperatorDecision[];
      };
    }
  | {
      type: "snapshot";
      detail: ThreadDetail;
      detailSha256: string;
      detailBytes: number;
      eventBytes: number;
    }
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
      snapshotBytes: number;
      eventCount: number;
      eventBytes: number;
      eventStreamSha256: string;
    };

export interface ExecutionPlanWorkflowResultFrame {
  type: "workflow_result";
  threadId: string;
  planId: string;
  status: ExecutionPlanWorkflowStatus;
  manifestSha256: string;
  result: ExecutionPlanWorkflowResult;
  snapshotSha256: string;
  snapshotBytes: number;
  eventCount: number;
  eventBytes: number;
  eventStreamSha256: string;
  contentSha256: string;
}

export interface ExecutionPlanWorkflowExperimentResultFrame {
  type: "workflow_experiment_result";
  sourceThreadId: string;
  sourcePlanId: string;
  targetThreadId: string;
  targetPlanId: string;
  status: ExecutionPlanWorkflowStatus;
  previewSha256: string;
  candidateManifestSha256: string;
  experiment: ExecutionPlanWorkflowExperimentResult;
  snapshotSha256: string;
  snapshotBytes: number;
  eventCount: number;
  eventBytes: number;
  eventStreamSha256: string;
  contentSha256: string;
}

export interface AgentMessageExperimentResultFrame {
  type: "agent_message_experiment_result";
  sourceThreadId: string;
  sourceRunId: string;
  sourceMessageSeq: number;
  targetThreadId: string;
  targetRunId: string;
  status: TerminalRunStatus;
  previewSha256: string;
  experiment: AgentMessageExperimentResult;
  snapshotSha256: string;
  snapshotBytes: number;
  eventCount: number;
  eventBytes: number;
  eventStreamSha256: string;
  contentSha256: string;
}

export interface ModelInvocationExperimentResultFrame {
  type: "model_invocation_experiment_result";
  sourceThreadId: string;
  sourceRunId: string;
  sourceTurnIndex: number;
  targetThreadId: string;
  targetRunId: string;
  status: ModelInvocationExperimentStatus;
  previewSha256: string;
  experiment: ModelInvocationExperimentResult;
  snapshotSha256: string;
  snapshotBytes: number;
  eventCount: number;
  eventBytes: number;
  eventStreamSha256: string;
  contentSha256: string;
}

export interface ToolInvocationExperimentResultFrame {
  type: "tool_invocation_experiment_result";
  sourceThreadId: string;
  sourceRunId: string;
  sourceCallId: string;
  targetThreadId: string;
  targetRunId: string;
  status: ToolInvocationExperimentStatus;
  previewSha256: string;
  experiment: ToolInvocationExperimentResult;
  snapshotSha256: string;
  snapshotBytes: number;
  eventCount: number;
  eventBytes: number;
  eventStreamSha256: string;
  contentSha256: string;
}

export function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}
