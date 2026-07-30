import type {
  ExecutionPlan,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";

export interface WorkflowExecutionContext {
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  input: JsonValue;
  agentId: string;
  agentRevision: number;
  plan: ExecutionPlan;
  resumed: boolean;
  retryBlocked: boolean;
  onEvent?: EventSink;
  signal?: AbortSignal;
  outputs: Map<string, JsonValue>;
  nodeResults: Map<string, ExecutionPlanWorkflowNodeResult>;
  reusedNodes: WorkflowReusedNode[];
}

export interface WorkflowNodeFailure {
  runId?: string;
  inputSha256: string;
  attempt: number;
  errorCode: string;
  diagnosticSha256: string;
}

export interface WorkflowReusedNode {
  nodeId: string;
  output: JsonValue;
  sourceThreadId: string;
  sourcePlanId: string;
  sourceStatus: "completed" | "skipped";
  sourceRunId?: string;
  sourceAttempt: number;
  sourceInputSha256: string;
  sourceOutputSha256: string;
}

export interface WorkflowExperimentLineage {
  sourceThreadId: string;
  sourcePlanId: string;
  sourcePlanRevision: number;
  sourceManifestSha256: string;
  fromNodeId: string;
  reusedNodeIds: string[];
  rerunNodeIds: string[];
  previewSha256: string;
  sideEffectsConfirmed: boolean;
}
