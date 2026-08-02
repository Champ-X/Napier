import type {
  JsonValue,
  ModelRef,
  RunInvocationSource,
} from "./execution-core.js";
import type {
  ExecutionPlanStatus,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  ExecutionPlanWorkflowStatus,
  PlanStepStatus,
} from "./execution-workflows.js";

export interface ExecutionPlanWorkflowExperimentToolEffects {
  nodeId: string;
  attemptCount: number;
  toolCallCount: number;
  readOnlyCount: number;
  writeCount: number;
  unknownCount: number;
  unresolvedCount: number;
  writeToolNames: string[];
  unknownToolNames: string[];
}

export type ExecutionPlanWorkflowExperimentMode =
  | "subgraph"
  | "single_node"
  | "step_nodes"
  | "simulate_node"
  | "replace_input"
  | "replace_workflow_input";

interface ExecutionPlanWorkflowExperimentPreviewBase {
  kind: "napier.execution-plan-workflow-experiment-preview";
  sourceThreadId: string;
  sourcePlanId: string;
  sourcePlanRevision: number;
  sourceManifestSha256: string;
  candidateManifestSha256: string;
  sourceAgentId: string;
  sourceAgentRevision: number;
  fromNodeId: string;
  reusedNodeIds: string[];
  rerunNodeIds: string[];
  modelOverrides: Record<string, ModelRef>;
  toolEffects: ExecutionPlanWorkflowExperimentToolEffects[];
  requiresSideEffectConfirmation: boolean;
  previewSha256: string;
}

export interface ExecutionPlanWorkflowExperimentPreviewV1 extends ExecutionPlanWorkflowExperimentPreviewBase {
  schemaVersion: 1;
}

export interface ExecutionPlanWorkflowExperimentPreviewV2 extends ExecutionPlanWorkflowExperimentPreviewBase {
  schemaVersion: 2;
  mode: "single_node";
  executionNodeIds: string[];
  stopBeforeNodeIds: string[];
}

export interface ExecutionPlanWorkflowExperimentPreviewV3 extends ExecutionPlanWorkflowExperimentPreviewBase {
  schemaVersion: 3;
  mode: "simulate_node";
  executionNodeIds: string[];
  simulatedNodeId: string;
  simulatedOutputSha256: string;
  simulatedOutputBytes: number;
}

export interface ExecutionPlanWorkflowExperimentPreviewV4 extends ExecutionPlanWorkflowExperimentPreviewBase {
  schemaVersion: 4;
  mode: "replace_input";
  executionNodeIds: string[];
  replacedInputNodeId: string;
  replacementInputSha256: string;
  replacementInputBytes: number;
}

export interface ExecutionPlanWorkflowExperimentPreviewV5 extends ExecutionPlanWorkflowExperimentPreviewBase {
  schemaVersion: 5;
  mode: "step_nodes";
  executionNodeIds: string[];
  stopBeforeNodeIds: string[];
}

export interface ExecutionPlanWorkflowExperimentPreviewV6 extends Omit<
  ExecutionPlanWorkflowExperimentPreviewBase,
  "fromNodeId"
> {
  schemaVersion: 6;
  mode: "replace_workflow_input";
  executionNodeIds: string[];
  replacementWorkflowInputSha256: string;
  replacementWorkflowInputBytes: number;
}

export type ExecutionPlanWorkflowExperimentPreview =
  | ExecutionPlanWorkflowExperimentPreviewV1
  | ExecutionPlanWorkflowExperimentPreviewV2
  | ExecutionPlanWorkflowExperimentPreviewV3
  | ExecutionPlanWorkflowExperimentPreviewV4
  | ExecutionPlanWorkflowExperimentPreviewV5
  | ExecutionPlanWorkflowExperimentPreviewV6;

export interface ExecutionPlanWorkflowExperimentMetricSet {
  runCount: number;
  attemptCount: number;
  durationMs: number;
  modelResponseCount: number;
  toolCallCount: number;
  toolCompletedCount: number;
  toolFailedCount: number;
  toolBlockedCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface ExecutionPlanWorkflowExperimentEvaluationSummary {
  total: number;
  leftBetter: number;
  rightBetter: number;
  tie: number;
  inconclusive: number;
}

export interface ExecutionPlanWorkflowExperimentArtifactSummary {
  total: number;
  produced: number;
  verified: number;
  missing: number;
  setSha256: string;
}

export type ExecutionPlanWorkflowExperimentValueChange =
  | "unchanged"
  | "changed"
  | "became_available"
  | "became_unavailable"
  | "unavailable";

export interface ExecutionPlanWorkflowExperimentNodeObservation {
  status: PlanStepStatus;
  runIds: string[];
  runSources: RunInvocationSource[];
  models: ModelRef[];
  configurationSha256s: string[];
  toolNames: string[];
  inputSha256?: string;
  outputSha256?: string;
  metrics: ExecutionPlanWorkflowExperimentMetricSet;
  evaluations: ExecutionPlanWorkflowExperimentEvaluationSummary;
}

export interface ExecutionPlanWorkflowExperimentNodeComparison {
  nodeId: string;
  execution: "reused" | "rerun" | "simulated" | "input_replaced";
  source: ExecutionPlanWorkflowExperimentNodeObservation;
  target: ExecutionPlanWorkflowExperimentNodeObservation;
  statusChanged: boolean;
  modelChanged: boolean;
  configurationChanged: boolean;
  inputChange: ExecutionPlanWorkflowExperimentValueChange;
  outputChange: ExecutionPlanWorkflowExperimentValueChange;
  metricDelta: ExecutionPlanWorkflowExperimentMetricSet;
  addedToolNames: string[];
  removedToolNames: string[];
}

export interface ExecutionPlanWorkflowExperimentComparison {
  kind: "napier.execution-plan-workflow-experiment-comparison";
  schemaVersion: 1;
  sourceThreadId: string;
  sourcePlanId: string;
  targetThreadId: string;
  targetPlanId: string;
  sourceStatus: ExecutionPlanStatus;
  targetStatus: ExecutionPlanWorkflowStatus;
  sourceInputSha256: string;
  targetInputSha256: string;
  inputChange: ExecutionPlanWorkflowExperimentValueChange;
  sourceOutputSha256?: string;
  targetOutputSha256?: string;
  outputChange: ExecutionPlanWorkflowExperimentValueChange;
  reusedNodeCount: number;
  rerunNodeCount: number;
  sourceMetrics: ExecutionPlanWorkflowExperimentMetricSet;
  targetMetrics: ExecutionPlanWorkflowExperimentMetricSet;
  metricDelta: ExecutionPlanWorkflowExperimentMetricSet;
  sourceEvaluations: ExecutionPlanWorkflowExperimentEvaluationSummary;
  targetEvaluations: ExecutionPlanWorkflowExperimentEvaluationSummary;
  sourceArtifacts: ExecutionPlanWorkflowExperimentArtifactSummary;
  targetArtifacts: ExecutionPlanWorkflowExperimentArtifactSummary;
  changedNodeIds: string[];
  nodes: ExecutionPlanWorkflowExperimentNodeComparison[];
  contentSha256: string;
}

export interface CreateExecutionPlanWorkflowExperimentRequest {
  manifest: ExecutionPlanWorkflowManifest;
  planId: string;
  fromNodeId?: string;
  mode?: ExecutionPlanWorkflowExperimentMode;
  simulatedOutput?: JsonValue;
  replacementInput?: JsonValue;
  replacementWorkflowInput?: JsonValue;
  title?: string;
  modelOverrides?: Record<string, ModelRef>;
  confirmSideEffects?: boolean;
  expectedPreviewSha256?: string;
}

export interface ExecutionPlanWorkflowExperimentResult {
  kind: "napier.execution-plan-workflow-experiment-result";
  schemaVersion: 1;
  preview: ExecutionPlanWorkflowExperimentPreview;
  sourceManifest: ExecutionPlanWorkflowManifest;
  candidateManifest: ExecutionPlanWorkflowManifest;
  targetThreadId: string;
  result: ExecutionPlanWorkflowResult;
  comparison?: ExecutionPlanWorkflowExperimentComparison;
}
