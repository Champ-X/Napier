import {
  EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA,
  EXECUTION_PLAN_WORKFLOW_TOOL_NAMES,
  type ExecutionPlanWorkflowInputBinding,
  type ExecutionPlanWorkflowExperimentComparison,
  type ExecutionPlanWorkflowExperimentNodeComparison,
  type ExecutionPlanWorkflowExperimentResultFrame,
  type ExecutionPlanWorkflowManifest,
  type JsonValue,
  type ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";

const SHA256 = /^[a-f0-9]{64}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const BINDING_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const WORKFLOW_TOOL_NAMES = new Set<string>(EXECUTION_PLAN_WORKFLOW_TOOL_NAMES);
const FORBIDDEN_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

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
      (nodeInput["type"] !== "agent" &&
        nodeInput["type"] !== "tool" &&
        nodeInput["type"] !== "approval") ||
      !record(nodeInput["inputBindings"]) ||
      !record(nodeInput["inputSchema"]) ||
      !record(nodeInput["outputSchema"]) ||
      !Number.isSafeInteger(nodeInput["timeoutMs"]) ||
      !Number.isSafeInteger(nodeInput["maxAttempts"])
    ) {
      throw new Error("Workflow manifest node is invalid");
    }
    if (
      nodeInput["type"] === "tool" &&
      (typeof nodeInput["tool"] !== "string" ||
        !WORKFLOW_TOOL_NAMES.has(nodeInput["tool"]) ||
        (nodeInput["effect"] !== "read" && nodeInput["effect"] !== "write"))
    ) {
      throw new Error("Workflow manifest Tool node is invalid");
    }
    if (
      nodeInput["type"] === "approval" &&
      (typeof nodeInput["header"] !== "string" ||
        nodeInput["header"].trim().length < 1 ||
        nodeInput["header"].trim().length > 12 ||
        typeof nodeInput["question"] !== "string" ||
        nodeInput["question"].trim().length < 1 ||
        !workflowApprovalChoice(nodeInput["approve"]) ||
        !workflowApprovalChoice(nodeInput["reject"]) ||
        canonicalJson(nodeInput["outputSchema"]) !==
          canonicalJson(EXECUTION_PLAN_WORKFLOW_APPROVAL_OUTPUT_SCHEMA))
    ) {
      throw new Error("Workflow manifest Approval node is invalid");
    }
    for (const [name, binding] of Object.entries(nodeInput["inputBindings"])) {
      if (!BINDING_NAME.test(name)) {
        throw new Error("Workflow manifest binding name is invalid");
      }
      validateWorkflowBinding(binding);
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

function workflowApprovalChoice(input: unknown): boolean {
  return (
    record(input) &&
    exactKeys(input, ["label", "description"]) &&
    typeof input["label"] === "string" &&
    input["label"].trim().length >= 1 &&
    input["label"].trim().length <= 80 &&
    typeof input["description"] === "string" &&
    input["description"].trim().length >= 1 &&
    input["description"].trim().length <= 400
  );
}

function validateWorkflowBinding(
  input: unknown,
): ExecutionPlanWorkflowInputBinding {
  if (!record(input)) {
    throw new Error("Workflow manifest binding is invalid");
  }
  if (input["source"] === "literal") {
    if (
      !exactKeys(input, ["source", "value"]) ||
      !jsonValue(input["value"], 0)
    ) {
      throw new Error("Workflow manifest literal binding is invalid");
    }
    return { source: "literal", value: input["value"] as JsonValue };
  }
  const path = validateWorkflowBindingPath(input["path"]);
  if (input["source"] === "workflow") {
    if (!exactKeys(input, ["source"], ["path"])) {
      throw new Error("Workflow manifest Workflow binding is invalid");
    }
    return { source: "workflow", ...(path ? { path } : {}) };
  }
  if (
    input["source"] !== "node" ||
    !exactKeys(input, ["source", "nodeId"], ["path"]) ||
    typeof input["nodeId"] !== "string" ||
    !NODE_ID.test(input["nodeId"])
  ) {
    throw new Error("Workflow manifest binding source is invalid");
  }
  return {
    source: "node",
    nodeId: input["nodeId"],
    ...(path ? { path } : {}),
  };
}

function validateWorkflowBindingPath(
  input: unknown,
): Array<string | number> | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) {
    throw new Error("Workflow manifest binding path is invalid");
  }
  return input.map((segment) => {
    if (
      typeof segment === "number" &&
      Number.isSafeInteger(segment) &&
      segment >= 0
    ) {
      return segment;
    }
    if (
      typeof segment === "string" &&
      BINDING_NAME.test(segment) &&
      !FORBIDDEN_PATH_SEGMENTS.has(segment)
    ) {
      return segment;
    }
    throw new Error("Workflow manifest binding path segment is invalid");
  });
}

function exactKeys(
  input: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(input, key)) &&
    Object.keys(input).every((key) => allowed.has(key))
  );
}

function jsonValue(input: unknown, depth: number): input is JsonValue {
  if (depth > 16) return false;
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return true;
  }
  if (typeof input === "number") return Number.isFinite(input);
  if (Array.isArray(input)) {
    return (
      input.length <= 256 && input.every((item) => jsonValue(item, depth + 1))
    );
  }
  if (!record(input) || Object.keys(input).length > 64) return false;
  return Object.values(input).every((value) => jsonValue(value, depth + 1));
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
