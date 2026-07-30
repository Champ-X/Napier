import type {
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentNodeComparison,
  ExecutionPlanWorkflowExperimentResultFrame,
  ExecutionPlanWorkflowManifest,
  ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";

const SHA256 = /^[a-f0-9]{64}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface WorkflowExperimentNodeView {
  nodeId: string;
  execution: "reused" | "rerun";
  sourceStatus: string;
  targetStatus: string;
  statusChanged: boolean;
  modelChanged: boolean;
  configurationChanged: boolean;
  inputChange: ExecutionPlanWorkflowExperimentNodeComparison["inputChange"];
  outputChange: ExecutionPlanWorkflowExperimentNodeComparison["outputChange"];
  sourceModels: string[];
  targetModels: string[];
  attemptDelta: number;
  durationMsDelta: number;
  tokenDelta: number;
  toolCallDelta: number;
  costUsdDelta: number;
  addedToolNames: string[];
  removedToolNames: string[];
}

export interface WorkflowExperimentComparisonView {
  sourceStatus: string;
  targetStatus: string;
  inputChange: ExecutionPlanWorkflowExperimentComparison["inputChange"];
  outputChange: ExecutionPlanWorkflowExperimentComparison["outputChange"];
  reusedNodeCount: number;
  rerunNodeCount: number;
  changedNodeCount: number;
  runDelta: number;
  attemptDelta: number;
  durationMsDelta: number;
  tokenDelta: number;
  toolCallDelta: number;
  costUsdDelta: number;
  evaluationDelta: number;
  artifactDelta: number;
  nodes: WorkflowExperimentNodeView[];
  comparisonSha256: string;
}

export async function parseWorkflowManifestText(
  text: string,
): Promise<ExecutionPlanWorkflowManifest> {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Workflow manifest JSON is invalid");
  }
  return validateWorkflowManifest(input);
}

export async function validateWorkflowManifest(
  input: unknown,
): Promise<ExecutionPlanWorkflowManifest> {
  if (!record(input)) throw new Error("Workflow manifest must be an object");
  if (
    input["kind"] !== "napier.execution-plan-workflow" ||
    input["schemaVersion"] !== 1 ||
    typeof input["apiVersion"] !== "string" ||
    typeof input["generatedAt"] !== "string" ||
    typeof input["name"] !== "string" ||
    typeof input["version"] !== "number" ||
    !Number.isSafeInteger(input["version"]) ||
    Number(input["version"]) < 1 ||
    typeof input["description"] !== "string" ||
    typeof input["outputNodeId"] !== "string" ||
    !NODE_ID.test(input["outputNodeId"]) ||
    !Array.isArray(input["nodes"]) ||
    input["nodes"].length < 1 ||
    input["nodes"].length > 30 ||
    input["nodeCount"] !== input["nodes"].length ||
    typeof input["contentSha256"] !== "string" ||
    !SHA256.test(input["contentSha256"]) ||
    !record(input["blueprint"]) ||
    !record(input["inputSchema"]) ||
    !record(input["outputSchema"])
  ) {
    throw new Error("Workflow manifest shape is invalid");
  }
  const nodeIds = new Set<string>();
  for (const nodeInput of input["nodes"]) {
    if (
      !record(nodeInput) ||
      typeof nodeInput["id"] !== "string" ||
      !NODE_ID.test(nodeInput["id"]) ||
      nodeIds.has(nodeInput["id"]) ||
      nodeInput["type"] !== "agent" ||
      !record(nodeInput["inputBindings"]) ||
      !record(nodeInput["inputSchema"]) ||
      !record(nodeInput["outputSchema"]) ||
      !Number.isSafeInteger(nodeInput["timeoutMs"]) ||
      !Number.isSafeInteger(nodeInput["maxAttempts"])
    ) {
      throw new Error("Workflow manifest node is invalid");
    }
    nodeIds.add(nodeInput["id"]);
  }
  if (!nodeIds.has(input["outputNodeId"])) {
    throw new Error("Workflow output node is missing");
  }
  const content = {
    kind: input["kind"],
    schemaVersion: input["schemaVersion"],
    apiVersion: input["apiVersion"],
    name: input["name"],
    version: input["version"],
    description: input["description"],
    blueprint: input["blueprint"],
    inputSchema: input["inputSchema"],
    outputSchema: input["outputSchema"],
    outputNodeId: input["outputNodeId"],
    nodes: input["nodes"],
    nodeCount: input["nodeCount"],
  };
  if ((await sha256Text(canonicalJson(content))) !== input["contentSha256"]) {
    throw new Error("Workflow manifest content hash is invalid");
  }
  return structuredClone(input) as unknown as ExecutionPlanWorkflowManifest;
}

export function parseWorkflowModelKey(key: string): ModelRef {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) {
    throw new Error("Selected model key is invalid");
  }
  return {
    provider: key.slice(0, slash),
    id: key.slice(slash + 1),
  };
}

export function projectWorkflowExperimentComparison(
  comparison: ExecutionPlanWorkflowExperimentComparison,
): WorkflowExperimentComparisonView {
  return {
    sourceStatus: comparison.sourceStatus,
    targetStatus: comparison.targetStatus,
    inputChange: comparison.inputChange,
    outputChange: comparison.outputChange,
    reusedNodeCount: comparison.reusedNodeCount,
    rerunNodeCount: comparison.rerunNodeCount,
    changedNodeCount: comparison.changedNodeIds.length,
    runDelta: comparison.metricDelta.runCount,
    attemptDelta: comparison.metricDelta.attemptCount,
    durationMsDelta: comparison.metricDelta.durationMs,
    tokenDelta:
      comparison.metricDelta.inputTokens + comparison.metricDelta.outputTokens,
    toolCallDelta: comparison.metricDelta.toolCallCount,
    costUsdDelta: comparison.metricDelta.costUsd,
    evaluationDelta:
      comparison.targetEvaluations.total - comparison.sourceEvaluations.total,
    artifactDelta:
      comparison.targetArtifacts.total - comparison.sourceArtifacts.total,
    nodes: comparison.nodes.map(projectNode),
    comparisonSha256: comparison.contentSha256,
  };
}

export function workflowExperimentResultFilename(
  frame: ExecutionPlanWorkflowExperimentResultFrame,
): string {
  return `napier-workflow-experiment-${safeSegment(frame.targetPlanId, "plan")}-${frame.contentSha256.slice(0, 16)}.json`;
}

function projectNode(
  node: ExecutionPlanWorkflowExperimentNodeComparison,
): WorkflowExperimentNodeView {
  return {
    nodeId: node.nodeId,
    execution: node.execution,
    sourceStatus: node.source.status,
    targetStatus: node.target.status,
    statusChanged: node.statusChanged,
    modelChanged: node.modelChanged,
    configurationChanged: node.configurationChanged,
    inputChange: node.inputChange,
    outputChange: node.outputChange,
    sourceModels: node.source.models.map(modelLabel),
    targetModels: node.target.models.map(modelLabel),
    attemptDelta: node.metricDelta.attemptCount,
    durationMsDelta: node.metricDelta.durationMs,
    tokenDelta: node.metricDelta.inputTokens + node.metricDelta.outputTokens,
    toolCallDelta: node.metricDelta.toolCallCount,
    costUsdDelta: node.metricDelta.costUsd,
    addedToolNames: [...node.addedToolNames],
    removedToolNames: [...node.removedToolNames],
  };
}

function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`;
}

function safeSegment(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 96);
  return normalized || fallback;
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}
