import type {
  ExecutionPlanStatus,
  ExecutionPlanWorkflowExperimentArtifactSummary,
  ExecutionPlanWorkflowExperimentComparison,
  ExecutionPlanWorkflowExperimentEvaluationSummary,
  ExecutionPlanWorkflowExperimentMetricSet,
  ExecutionPlanWorkflowExperimentNodeComparison,
  ExecutionPlanWorkflowExperimentNodeObservation,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentValueChange,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  ModelRef,
  PlanStepStatus,
  RunInvocationSource,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  canonicalWorkflowExperimentStrings,
  subtractWorkflowExperimentMetrics,
  sumWorkflowExperimentMetrics,
  workflowExperimentConfigurationChanged,
  WORKFLOW_EXPERIMENT_METRIC_KEYS,
  workflowExperimentNodeChanged,
  workflowExperimentValueChange,
} from "./workflow-experiment-comparison-model.js";

const HASH = /^[a-f0-9]{64}$/u;
const THREAD_ID = /^thread_[a-z0-9]{8,80}$/u;
const PLAN_ID = /^plan_[a-z0-9]{8,80}$/u;
const RUN_ID = /^run_[a-z0-9]{8,80}$/u;
const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u;
export const MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES =
  1024 * 1024;

const PLAN_STATUSES = new Set<ExecutionPlanStatus>([
  "active",
  "completed",
  "blocked",
  "cancelled",
]);
const STEP_STATUSES = new Set<PlanStepStatus>([
  "pending",
  "ready",
  "running",
  "completed",
  "blocked",
  "skipped",
]);
const RUN_SOURCES = new Set<RunInvocationSource>([
  "workflow",
  "workflow_reuse",
]);

export function validateExecutionPlanWorkflowExperimentComparison(
  input: unknown,
): ExecutionPlanWorkflowExperimentComparison {
  assertEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_EXPERIMENT_COMPARISON_BYTES,
  );
  const comparison = record(input, "Workflow experiment comparison");
  assertExactKeys(
    comparison,
    [
      "kind",
      "schemaVersion",
      "sourceThreadId",
      "sourcePlanId",
      "targetThreadId",
      "targetPlanId",
      "sourceStatus",
      "targetStatus",
      "sourceInputSha256",
      "targetInputSha256",
      "inputChange",
      "sourceOutputSha256",
      "targetOutputSha256",
      "outputChange",
      "reusedNodeCount",
      "rerunNodeCount",
      "sourceMetrics",
      "targetMetrics",
      "metricDelta",
      "sourceEvaluations",
      "targetEvaluations",
      "sourceArtifacts",
      "targetArtifacts",
      "changedNodeIds",
      "nodes",
      "contentSha256",
    ],
    new Set(["sourceOutputSha256", "targetOutputSha256"]),
  );
  if (
    comparison["kind"] !==
      "napier.execution-plan-workflow-experiment-comparison" ||
    comparison["schemaVersion"] !== 1 ||
    !resourceId(comparison["sourceThreadId"], THREAD_ID) ||
    !resourceId(comparison["targetThreadId"], THREAD_ID) ||
    comparison["sourceThreadId"] === comparison["targetThreadId"] ||
    !resourceId(comparison["sourcePlanId"], PLAN_ID) ||
    !resourceId(comparison["targetPlanId"], PLAN_ID) ||
    comparison["sourcePlanId"] === comparison["targetPlanId"] ||
    !PLAN_STATUSES.has(comparison["sourceStatus"] as ExecutionPlanStatus) ||
    (comparison["targetStatus"] !== "completed" &&
      comparison["targetStatus"] !== "blocked" &&
      comparison["targetStatus"] !== "cancelled") ||
    !hash(comparison["sourceInputSha256"]) ||
    !hash(comparison["targetInputSha256"]) ||
    !valueChangeValue(comparison["inputChange"]) ||
    (comparison["sourceOutputSha256"] !== undefined &&
      !hash(comparison["sourceOutputSha256"])) ||
    (comparison["targetOutputSha256"] !== undefined &&
      !hash(comparison["targetOutputSha256"])) ||
    !valueChangeValue(comparison["outputChange"]) ||
    !nonNegativeInteger(comparison["reusedNodeCount"]) ||
    !nonNegativeInteger(comparison["rerunNodeCount"]) ||
    !hash(comparison["contentSha256"]) ||
    !Array.isArray(comparison["nodes"]) ||
    comparison["nodes"].length < 1 ||
    comparison["nodes"].length > 30
  ) {
    throw new Error("Workflow experiment comparison is invalid");
  }
  const sourceMetrics = validateMetrics(
    comparison["sourceMetrics"],
    false,
    "source metrics",
  );
  const targetMetrics = validateMetrics(
    comparison["targetMetrics"],
    false,
    "target metrics",
  );
  const metricDelta = validateMetrics(
    comparison["metricDelta"],
    true,
    "metric delta",
  );
  const sourceEvaluations = validateEvaluationSummary(
    comparison["sourceEvaluations"],
    "source evaluations",
  );
  const targetEvaluations = validateEvaluationSummary(
    comparison["targetEvaluations"],
    "target evaluations",
  );
  const sourceArtifacts = validateArtifactSummary(
    comparison["sourceArtifacts"],
    "source artifacts",
  );
  const targetArtifacts = validateArtifactSummary(
    comparison["targetArtifacts"],
    "target artifacts",
  );
  const nodes = comparison["nodes"].map((value, index) =>
    validateNodeComparison(value, index),
  );
  const sourceRunIds = nodes.flatMap((node) => node.source.runIds);
  const targetRunIds = nodes.flatMap((node) => node.target.runIds);
  if (
    new Set(nodes.map((node) => node.nodeId)).size !== nodes.length ||
    new Set(sourceRunIds).size !== sourceRunIds.length ||
    new Set(targetRunIds).size !== targetRunIds.length ||
    Number(comparison["reusedNodeCount"]) +
      Number(comparison["rerunNodeCount"]) !==
      nodes.length ||
    nodes.filter((node) => node.execution === "reused").length !==
      comparison["reusedNodeCount"] ||
    nodes.filter((node) => node.execution === "rerun").length !==
      comparison["rerunNodeCount"] ||
    canonicalJson(sourceMetrics) !==
      canonicalJson(
        sumWorkflowExperimentMetrics(nodes.map((node) => node.source.metrics)),
      ) ||
    canonicalJson(targetMetrics) !==
      canonicalJson(
        sumWorkflowExperimentMetrics(nodes.map((node) => node.target.metrics)),
      ) ||
    canonicalJson(metricDelta) !==
      canonicalJson(
        subtractWorkflowExperimentMetrics(sourceMetrics, targetMetrics),
      ) ||
    comparison["inputChange"] !==
      workflowExperimentValueChange(
        String(comparison["sourceInputSha256"]),
        String(comparison["targetInputSha256"]),
      ) ||
    comparison["outputChange"] !==
      workflowExperimentValueChange(
        comparison["sourceOutputSha256"] as string | undefined,
        comparison["targetOutputSha256"] as string | undefined,
      )
  ) {
    throw new Error("Workflow experiment comparison binding is invalid");
  }
  const changedNodeIds = nodeIdList(
    comparison["changedNodeIds"],
    "changed nodes",
  );
  if (
    canonicalJson(changedNodeIds) !==
    canonicalJson(
      nodes.filter(workflowExperimentNodeChanged).map((node) => node.nodeId),
    )
  ) {
    throw new Error("Workflow experiment changed-node binding is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = comparison;
  if (
    sha256(canonicalJson(content as JsonValue)) !== comparison["contentSha256"]
  ) {
    throw new Error("Workflow experiment comparison hash mismatch");
  }
  return structuredClone({
    ...comparison,
    sourceMetrics,
    targetMetrics,
    metricDelta,
    sourceEvaluations,
    targetEvaluations,
    sourceArtifacts,
    targetArtifacts,
    changedNodeIds,
    nodes,
  }) as ExecutionPlanWorkflowExperimentComparison;
}

export function assertExecutionPlanWorkflowExperimentComparisonBinding(
  comparison: ExecutionPlanWorkflowExperimentComparison,
  preview: ExecutionPlanWorkflowExperimentPreview,
  sourceManifest: ExecutionPlanWorkflowManifest,
  candidateManifest: ExecutionPlanWorkflowManifest,
  result: ExecutionPlanWorkflowResult,
): void {
  const validated =
    validateExecutionPlanWorkflowExperimentComparison(comparison);
  if (
    validated.sourceThreadId !== preview.sourceThreadId ||
    validated.sourcePlanId !== preview.sourcePlanId ||
    validated.targetThreadId !== result.threadId ||
    validated.targetPlanId !== result.planId ||
    validated.targetStatus !== result.status ||
    validated.reusedNodeCount !== preview.reusedNodeIds.length ||
    validated.rerunNodeCount !== preview.rerunNodeIds.length ||
    validated.nodes.length !== candidateManifest.nodeCount ||
    canonicalJson(validated.nodes.map((node) => node.nodeId)) !==
      canonicalJson(candidateManifest.nodes.map((node) => node.id)) ||
    validated.nodes.some(
      (node) =>
        node.execution !==
        (preview.rerunNodeIds.includes(node.nodeId) ? "rerun" : "reused"),
    ) ||
    validated.sourceOutputSha256 !==
      validated.nodes.find(
        (node) => node.nodeId === sourceManifest.outputNodeId,
      )?.source.outputSha256 ||
    validated.targetOutputSha256 !== result.outputSha256
  ) {
    throw new Error("Workflow experiment comparison result binding is invalid");
  }
  for (const nodeResult of result.nodeResults) {
    const observed = validated.nodes.find(
      (node) => node.nodeId === nodeResult.nodeId,
    )?.target;
    if (
      !observed ||
      observed.outputSha256 !== nodeResult.outputSha256 ||
      (nodeResult.runId !== undefined &&
        !observed.runIds.includes(nodeResult.runId))
    ) {
      throw new Error("Workflow experiment comparison node binding is invalid");
    }
  }
  for (const [index, node] of validated.nodes.entries()) {
    const sourceModel = sourceManifest.nodes[index]?.model;
    const targetModel = candidateManifest.nodes[index]?.model;
    const expectedRunSource =
      node.execution === "reused" ? "workflow_reuse" : "workflow";
    if (
      node.modelChanged !==
        (canonicalJson(sourceModel ?? null) !==
          canonicalJson(targetModel ?? null)) ||
      node.target.runSources.some((source) => source !== expectedRunSource)
    ) {
      throw new Error(
        "Workflow experiment comparison execution binding is invalid",
      );
    }
  }
}

function validateNodeComparison(
  input: unknown,
  index: number,
): ExecutionPlanWorkflowExperimentNodeComparison {
  const node = record(
    input,
    `Workflow experiment node comparison ${index + 1}`,
  );
  assertExactKeys(node, [
    "nodeId",
    "execution",
    "source",
    "target",
    "statusChanged",
    "modelChanged",
    "configurationChanged",
    "inputChange",
    "outputChange",
    "metricDelta",
    "addedToolNames",
    "removedToolNames",
  ]);
  if (
    !resourceId(node["nodeId"], NODE_ID) ||
    (node["execution"] !== "reused" && node["execution"] !== "rerun") ||
    typeof node["statusChanged"] !== "boolean" ||
    typeof node["modelChanged"] !== "boolean" ||
    typeof node["configurationChanged"] !== "boolean" ||
    !valueChangeValue(node["inputChange"]) ||
    !valueChangeValue(node["outputChange"])
  ) {
    throw new Error("Workflow experiment node comparison is invalid");
  }
  const source = validateObservation(node["source"], "source node");
  const target = validateObservation(node["target"], "target node");
  const metricDelta = validateMetrics(
    node["metricDelta"],
    true,
    "node metric delta",
  );
  const addedToolNames = toolNameList(node["addedToolNames"]);
  const removedToolNames = toolNameList(node["removedToolNames"]);
  const sourceTools = new Set(source.toolNames);
  const targetTools = new Set(target.toolNames);
  if (
    node["statusChanged"] !== (source.status !== target.status) ||
    node["configurationChanged"] !==
      workflowExperimentConfigurationChanged(
        node["execution"],
        source.configurationSha256s,
        target.configurationSha256s,
      ) ||
    node["inputChange"] !==
      workflowExperimentValueChange(source.inputSha256, target.inputSha256) ||
    node["outputChange"] !==
      workflowExperimentValueChange(source.outputSha256, target.outputSha256) ||
    canonicalJson(metricDelta) !==
      canonicalJson(
        subtractWorkflowExperimentMetrics(source.metrics, target.metrics),
      ) ||
    canonicalJson(addedToolNames) !==
      canonicalJson(
        target.toolNames.filter((name) => !sourceTools.has(name)),
      ) ||
    canonicalJson(removedToolNames) !==
      canonicalJson(source.toolNames.filter((name) => !targetTools.has(name)))
  ) {
    throw new Error("Workflow experiment node comparison binding is invalid");
  }
  return {
    nodeId: String(node["nodeId"]),
    execution: node["execution"],
    source,
    target,
    statusChanged: node["statusChanged"],
    modelChanged: node["modelChanged"],
    configurationChanged: node["configurationChanged"],
    inputChange: node["inputChange"],
    outputChange: node["outputChange"],
    metricDelta,
    addedToolNames,
    removedToolNames,
  };
}

function validateObservation(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowExperimentNodeObservation {
  const observation = record(input, label);
  assertExactKeys(
    observation,
    [
      "status",
      "runIds",
      "runSources",
      "models",
      "configurationSha256s",
      "toolNames",
      "inputSha256",
      "outputSha256",
      "metrics",
      "evaluations",
    ],
    new Set(["inputSha256", "outputSha256"]),
  );
  if (
    !STEP_STATUSES.has(observation["status"] as PlanStepStatus) ||
    (observation["inputSha256"] !== undefined &&
      !hash(observation["inputSha256"])) ||
    (observation["outputSha256"] !== undefined &&
      !hash(observation["outputSha256"]))
  ) {
    throw new Error(`Workflow experiment ${label} is invalid`);
  }
  const runIds = stringList(observation["runIds"], RUN_ID, 10, "run IDs");
  const runSources = runSourceVector(observation["runSources"], runIds.length);
  const models = modelVector(observation["models"], runIds.length);
  const configurationSha256s = hashVector(
    observation["configurationSha256s"],
    runIds.length,
  );
  const toolNames = toolNameList(observation["toolNames"]);
  const metrics = validateMetrics(
    observation["metrics"],
    false,
    "node metrics",
  );
  const evaluations = validateEvaluationSummary(
    observation["evaluations"],
    "node evaluations",
  );
  if (
    metrics.runCount !== runIds.length ||
    metrics.attemptCount > 10 ||
    runSources.length !== runIds.length ||
    models.length !== runIds.length ||
    configurationSha256s.length !== runIds.length
  ) {
    throw new Error("Workflow experiment node observation binding is invalid");
  }
  return {
    status: observation["status"] as PlanStepStatus,
    runIds,
    runSources,
    models,
    configurationSha256s,
    toolNames,
    ...(observation["inputSha256"]
      ? { inputSha256: String(observation["inputSha256"]) }
      : {}),
    ...(observation["outputSha256"]
      ? { outputSha256: String(observation["outputSha256"]) }
      : {}),
    metrics,
    evaluations,
  };
}

function validateMetrics(
  input: unknown,
  signed: boolean,
  label: string,
): ExecutionPlanWorkflowExperimentMetricSet {
  const metrics = record(input, `Workflow experiment ${label}`);
  assertExactKeys(metrics, WORKFLOW_EXPERIMENT_METRIC_KEYS);
  for (const key of WORKFLOW_EXPERIMENT_METRIC_KEYS) {
    const value = metrics[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (!signed && value < 0) ||
      (key !== "costUsd" && !Number.isSafeInteger(value))
    ) {
      throw new Error(`Workflow experiment ${label} is invalid`);
    }
  }
  return structuredClone(
    metrics,
  ) as unknown as ExecutionPlanWorkflowExperimentMetricSet;
}

function validateEvaluationSummary(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowExperimentEvaluationSummary {
  const summary = record(input, `Workflow experiment ${label}`);
  assertExactKeys(summary, [
    "total",
    "leftBetter",
    "rightBetter",
    "tie",
    "inconclusive",
  ]);
  if (
    Object.values(summary).some((value) => !nonNegativeInteger(value)) ||
    Number(summary["total"]) !==
      Number(summary["leftBetter"]) +
        Number(summary["rightBetter"]) +
        Number(summary["tie"]) +
        Number(summary["inconclusive"])
  ) {
    throw new Error(`Workflow experiment ${label} is invalid`);
  }
  return {
    total: Number(summary["total"]),
    leftBetter: Number(summary["leftBetter"]),
    rightBetter: Number(summary["rightBetter"]),
    tie: Number(summary["tie"]),
    inconclusive: Number(summary["inconclusive"]),
  };
}

function validateArtifactSummary(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowExperimentArtifactSummary {
  const summary = record(input, `Workflow experiment ${label}`);
  assertExactKeys(summary, [
    "total",
    "produced",
    "verified",
    "missing",
    "setSha256",
  ]);
  if (
    !nonNegativeInteger(summary["total"]) ||
    !nonNegativeInteger(summary["produced"]) ||
    !nonNegativeInteger(summary["verified"]) ||
    !nonNegativeInteger(summary["missing"]) ||
    !hash(summary["setSha256"]) ||
    Number(summary["produced"]) +
      Number(summary["verified"]) +
      Number(summary["missing"]) >
      Number(summary["total"])
  ) {
    throw new Error(`Workflow experiment ${label} is invalid`);
  }
  return {
    total: Number(summary["total"]),
    produced: Number(summary["produced"]),
    verified: Number(summary["verified"]),
    missing: Number(summary["missing"]),
    setSha256: String(summary["setSha256"]),
  };
}

function modelVector(input: unknown, expectedLength: number): ModelRef[] {
  if (!Array.isArray(input) || input.length !== expectedLength) {
    throw new Error("Workflow experiment models are invalid");
  }
  const models = input.map((value) => {
    const model = record(value, "Workflow experiment model");
    assertExactKeys(model, ["provider", "id"]);
    if (
      !resourceId(model["provider"], PROVIDER_ID) ||
      !resourceId(model["id"], MODEL_ID)
    ) {
      throw new Error("Workflow experiment model is invalid");
    }
    return { provider: String(model["provider"]), id: String(model["id"]) };
  });
  return models;
}

function nodeIdList(input: unknown, label: string): string[] {
  return stringList(input, NODE_ID, 30, label);
}

function hashVector(input: unknown, expectedLength: number): string[] {
  if (
    !Array.isArray(input) ||
    input.length !== expectedLength ||
    input.some((value) => !hash(value))
  ) {
    throw new Error("Workflow experiment hash vector is invalid");
  }
  return [...input] as string[];
}

function runSourceVector(
  input: unknown,
  expectedLength: number,
): RunInvocationSource[] {
  if (
    !Array.isArray(input) ||
    input.length !== expectedLength ||
    input.some((source) => !RUN_SOURCES.has(source as RunInvocationSource))
  ) {
    throw new Error("Workflow experiment run sources are invalid");
  }
  return [...input] as RunInvocationSource[];
}

function toolNameList(input: unknown): string[] {
  return stringList(input, TOOL_NAME, 128, "tool names");
}

function stringList(
  input: unknown,
  pattern: RegExp | undefined,
  maximum: number,
  label: string,
): string[] {
  if (
    !Array.isArray(input) ||
    input.length > maximum ||
    input.some(
      (value) =>
        typeof value !== "string" ||
        (pattern !== undefined && !pattern.test(value)),
    ) ||
    canonicalJson(input) !==
      canonicalJson(canonicalWorkflowExperimentStrings(input as string[]))
  ) {
    throw new Error(`Workflow experiment ${label} are invalid`);
  }
  return [...input] as string[];
}

function valueChangeValue(
  value: unknown,
): value is ExecutionPlanWorkflowExperimentValueChange {
  return (
    value === "unchanged" ||
    value === "changed" ||
    value === "became_available" ||
    value === "became_unavailable" ||
    value === "unavailable"
  );
}

function resourceId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error("Workflow experiment comparison fields are invalid");
  }
}

function assertEncodedBytes(input: unknown, maximum: number): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error("Workflow experiment comparison is not serializable JSON");
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maximum) {
    throw new Error("Workflow experiment comparison exceeds its byte limit");
  }
}
