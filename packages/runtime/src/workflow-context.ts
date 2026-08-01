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
  breakBeforeNodeIds: string[];
  continueBreakpoint: boolean;
  onEvent?: EventSink;
  signal?: AbortSignal;
  outputs: Map<string, JsonValue>;
  nodeResults: Map<string, ExecutionPlanWorkflowNodeResult>;
  reusedNodes: WorkflowReusedNode[];
  simulatedNodes: WorkflowSimulatedNode[];
  inputOverrides: WorkflowNodeInputOverride[];
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

export interface WorkflowSimulatedNode {
  nodeId: string;
  output: JsonValue;
  outputSha256: string;
  outputBytes: number;
}

export interface WorkflowNodeInputOverride {
  nodeId: string;
  input: JsonValue;
  inputSha256: string;
  inputBytes: number;
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
  executionMode?: "single_node" | "simulate_node" | "replace_input";
  executionNodeIds?: string[];
  stopBeforeNodeIds?: string[];
  simulationNodeId?: string;
  simulatedOutputSha256?: string;
  simulatedOutputBytes?: number;
  replacedInputNodeId?: string;
  replacementInputSha256?: string;
  replacementInputBytes?: number;
}
