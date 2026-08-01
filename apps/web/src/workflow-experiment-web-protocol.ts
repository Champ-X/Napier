import type { ExecutionPlanWorkflowExperimentResultFrame } from "@napier/contracts";

import { canonicalJson, sha256Text } from "./stable-digest";
import { validateWorkflowExperimentPreview } from "./workflow-experiment-preview-web-protocol";
import { validateWorkflowManifest } from "./workflow-experiment-view-model";

const SHA256 = /^[a-f0-9]{64}$/u;
const WORKFLOW_RUN_SOURCES = new Set([
  "workflow",
  "workflow_reuse",
  "workflow_simulation",
]);

export { validateWorkflowExperimentPreview } from "./workflow-experiment-preview-web-protocol";

export async function validateWorkflowExperimentResultFrame(
  input: unknown,
): Promise<ExecutionPlanWorkflowExperimentResultFrame> {
  if (!record(input)) throw new Error("Workflow experiment result is invalid");
  const required = [
    "type",
    "sourceThreadId",
    "sourcePlanId",
    "targetThreadId",
    "targetPlanId",
    "status",
    "previewSha256",
    "candidateManifestSha256",
    "experiment",
    "snapshotSha256",
    "snapshotBytes",
    "eventCount",
    "eventBytes",
    "eventStreamSha256",
    "contentSha256",
  ];
  if (
    !exactKeys(input, required) ||
    input["type"] !== "workflow_experiment_result" ||
    typeof input["sourceThreadId"] !== "string" ||
    typeof input["sourcePlanId"] !== "string" ||
    typeof input["targetThreadId"] !== "string" ||
    input["targetThreadId"] === input["sourceThreadId"] ||
    typeof input["targetPlanId"] !== "string" ||
    !workflowStatus(input["status"]) ||
    !hash(input["previewSha256"]) ||
    !hash(input["candidateManifestSha256"]) ||
    !hash(input["snapshotSha256"]) ||
    !nonNegativeInteger(input["snapshotBytes"]) ||
    !nonNegativeInteger(input["eventCount"]) ||
    !nonNegativeInteger(input["eventBytes"]) ||
    !hash(input["eventStreamSha256"]) ||
    !hash(input["contentSha256"]) ||
    !record(input["experiment"])
  ) {
    throw new Error("Workflow experiment result is invalid");
  }
  const experiment = input["experiment"];
  if (
    experiment["kind"] !== "napier.execution-plan-workflow-experiment-result" ||
    experiment["schemaVersion"] !== 1 ||
    experiment["targetThreadId"] !== input["targetThreadId"] ||
    !record(experiment["preview"]) ||
    !record(experiment["sourceManifest"]) ||
    !record(experiment["candidateManifest"]) ||
    !record(experiment["result"]) ||
    !record(experiment["comparison"])
  ) {
    throw new Error("Workflow experiment result binding is invalid");
  }
  const preview = await validateWorkflowExperimentPreview(
    experiment["preview"],
  );
  const sourceManifest = await validateWorkflowManifest(
    experiment["sourceManifest"],
  );
  const candidateManifest = await validateWorkflowManifest(
    experiment["candidateManifest"],
  );
  const result = experiment["result"];
  const comparison = experiment["comparison"];
  await validateComparison(comparison);
  if (
    result["kind"] !== "napier.execution-plan-workflow-result" ||
    result["schemaVersion"] !== 1 ||
    typeof result["threadId"] !== "string" ||
    typeof result["planId"] !== "string" ||
    !workflowStatus(result["status"]) ||
    !hash(result["manifestSha256"]) ||
    !hash(result["blueprintSha256"]) ||
    !hash(result["resultSha256"]) ||
    !Array.isArray(result["nodeResults"])
  ) {
    throw new Error("Workflow experiment Workflow result is invalid");
  }
  if (
    result["status"] === "paused"
      ? !validWorkflowBreakpoint(
          result["breakpoint"],
          Number(input["eventCount"]),
          candidateManifest.nodes.map((node) => node.id),
        )
      : result["breakpoint"] !== undefined
  ) {
    throw new Error("Workflow experiment breakpoint is invalid");
  }
  const { resultSha256: _resultSha256, ...resultContent } = result;
  if (
    (await sha256Text(canonicalJson(resultContent))) !== result["resultSha256"]
  ) {
    throw new Error("Workflow experiment Workflow result hash is invalid");
  }
  if (
    preview.sourceThreadId !== input["sourceThreadId"] ||
    preview.sourcePlanId !== input["sourcePlanId"] ||
    preview.previewSha256 !== input["previewSha256"] ||
    sourceManifest.contentSha256 !== preview.sourceManifestSha256 ||
    candidateManifest.contentSha256 !== input["candidateManifestSha256"] ||
    candidateManifest.contentSha256 !== preview.candidateManifestSha256 ||
    result["threadId"] !== input["targetThreadId"] ||
    result["planId"] !== input["targetPlanId"] ||
    result["status"] !== input["status"] ||
    result["manifestSha256"] !== candidateManifest.contentSha256 ||
    comparison.sourceThreadId !== input["sourceThreadId"] ||
    comparison.sourcePlanId !== input["sourcePlanId"] ||
    comparison.targetThreadId !== input["targetThreadId"] ||
    comparison.targetPlanId !== input["targetPlanId"] ||
    comparison.targetStatus !== input["status"] ||
    !workflowResultComparisonNodesMatch(
      result["nodeResults"],
      comparison["nodes"],
    )
  ) {
    throw new Error("Workflow experiment result binding is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = input;
  if ((await sha256Text(canonicalJson(content))) !== input["contentSha256"]) {
    throw new Error("Workflow experiment result hash is invalid");
  }
  return structuredClone(
    input,
  ) as unknown as ExecutionPlanWorkflowExperimentResultFrame;
}

function validWorkflowBreakpoint(
  input: unknown,
  eventCount: number,
  manifestNodeIds: string[],
): boolean {
  if (!record(input)) return false;
  return (
    exactKeys(input, [
      "nodeId",
      "breakpointIndex",
      "breakpointCount",
      "reachedEventSeq",
      "bindingContextSha256",
    ]) &&
    typeof input["nodeId"] === "string" &&
    manifestNodeIds.includes(input["nodeId"]) &&
    nonNegativeInteger(input["breakpointIndex"]) &&
    positiveInteger(input["breakpointCount"]) &&
    Number(input["breakpointCount"]) <= 16 &&
    Number(input["breakpointIndex"]) < Number(input["breakpointCount"]) &&
    positiveInteger(input["reachedEventSeq"]) &&
    Number(input["reachedEventSeq"]) <= eventCount &&
    hash(input["bindingContextSha256"])
  );
}

async function validateComparison(
  input: Record<string, unknown>,
): Promise<void> {
  if (
    input["kind"] !== "napier.execution-plan-workflow-experiment-comparison" ||
    input["schemaVersion"] !== 1 ||
    typeof input["sourceThreadId"] !== "string" ||
    typeof input["sourcePlanId"] !== "string" ||
    typeof input["targetThreadId"] !== "string" ||
    typeof input["targetPlanId"] !== "string" ||
    !workflowStatusOrActive(input["sourceStatus"]) ||
    !workflowStatus(input["targetStatus"]) ||
    !validMetricSet(input["sourceMetrics"], false) ||
    !validMetricSet(input["targetMetrics"], false) ||
    !validMetricSet(input["metricDelta"], true) ||
    !validEvaluationSummary(input["sourceEvaluations"]) ||
    !validEvaluationSummary(input["targetEvaluations"]) ||
    !validArtifactSummary(input["sourceArtifacts"]) ||
    !validArtifactSummary(input["targetArtifacts"]) ||
    !stringArray(input["changedNodeIds"], 30) ||
    !Array.isArray(input["nodes"]) ||
    input["nodes"].length < 1 ||
    input["nodes"].some((node) => !validComparisonNode(node)) ||
    !hash(input["contentSha256"])
  ) {
    throw new Error("Workflow experiment comparison is invalid");
  }
  const { contentSha256: _contentSha256, ...content } = input;
  if ((await sha256Text(canonicalJson(content))) !== input["contentSha256"]) {
    throw new Error("Workflow experiment comparison hash is invalid");
  }
}

function validComparisonNode(input: unknown): boolean {
  if (!record(input) || !record(input["source"]) || !record(input["target"])) {
    return false;
  }
  return (
    typeof input["nodeId"] === "string" &&
    (input["execution"] === "reused" ||
      input["execution"] === "rerun" ||
      input["execution"] === "simulated") &&
    typeof input["statusChanged"] === "boolean" &&
    typeof input["modelChanged"] === "boolean" &&
    typeof input["configurationChanged"] === "boolean" &&
    valueChange(input["inputChange"]) &&
    valueChange(input["outputChange"]) &&
    validObservation(input["source"]) &&
    validObservation(input["target"]) &&
    validMetricSet(input["metricDelta"], true) &&
    stringArray(input["addedToolNames"], 128) &&
    stringArray(input["removedToolNames"], 128)
  );
}

function validObservation(input: Record<string, unknown>): boolean {
  const valid =
    planStepStatus(input["status"]) &&
    stringArray(input["runIds"], 10) &&
    stringArray(input["runSources"], 10) &&
    input["runSources"].every((source) => WORKFLOW_RUN_SOURCES.has(source)) &&
    modelArray(input["models"], 10) &&
    stringArray(input["configurationSha256s"], 10) &&
    stringArray(input["toolNames"], 128) &&
    validMetricSet(input["metrics"], false) &&
    validEvaluationSummary(input["evaluations"]);
  if (!valid) return false;
  if (input["status"] !== "skipped") return true;
  return (
    (input["runIds"] as unknown[]).length === 0 &&
    (input["runSources"] as unknown[]).length === 0 &&
    (input["models"] as unknown[]).length === 0 &&
    (input["configurationSha256s"] as unknown[]).length === 0 &&
    (input["toolNames"] as unknown[]).length === 0 &&
    hash(input["inputSha256"]) &&
    hash(input["outputSha256"]) &&
    record(input["metrics"]) &&
    Object.values(input["metrics"]).every((value) => value === 0) &&
    record(input["evaluations"]) &&
    Object.values(input["evaluations"]).every((value) => value === 0)
  );
}

const METRIC_KEYS = [
  "runCount",
  "attemptCount",
  "durationMs",
  "modelResponseCount",
  "toolCallCount",
  "toolCompletedCount",
  "toolFailedCount",
  "toolBlockedCount",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "costUsd",
] as const;

function validMetricSet(input: unknown, signed: boolean): boolean {
  if (!record(input) || !exactKeys(input, [...METRIC_KEYS])) return false;
  return METRIC_KEYS.every((key) => {
    const value = input[key];
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (signed || value >= 0) &&
      (key === "costUsd" || Number.isSafeInteger(value))
    );
  });
}

function validEvaluationSummary(input: unknown): boolean {
  if (!record(input)) return false;
  return ["total", "leftBetter", "rightBetter", "tie", "inconclusive"].every(
    (key) => nonNegativeInteger(input[key]),
  );
}

function validArtifactSummary(input: unknown): boolean {
  return (
    record(input) &&
    nonNegativeInteger(input["total"]) &&
    nonNegativeInteger(input["produced"]) &&
    nonNegativeInteger(input["verified"]) &&
    nonNegativeInteger(input["missing"]) &&
    hash(input["setSha256"])
  );
}

function modelArray(input: unknown, maximum: number): boolean {
  return (
    Array.isArray(input) &&
    input.length <= maximum &&
    input.every(
      (model) =>
        record(model) &&
        typeof model["provider"] === "string" &&
        typeof model["id"] === "string",
    )
  );
}

function exactKeys(input: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return (
    Object.keys(input).length === keys.length &&
    Object.keys(input).every((key) => expected.has(key))
  );
}

function record(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function hash(input: unknown): input is string {
  return typeof input === "string" && SHA256.test(input);
}

function positiveInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 1;
}

function nonNegativeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input) && Number(input) >= 0;
}

function stringArray(input: unknown, maximum: number): input is string[] {
  return (
    Array.isArray(input) &&
    input.length <= maximum &&
    input.every((value) => typeof value === "string")
  );
}

function workflowStatus(
  input: unknown,
): input is "completed" | "waiting" | "paused" | "blocked" | "cancelled" {
  return (
    input === "completed" ||
    input === "waiting" ||
    input === "paused" ||
    input === "blocked" ||
    input === "cancelled"
  );
}

function workflowStatusOrActive(input: unknown): boolean {
  return input === "active" || workflowStatus(input);
}

function workflowResultComparisonNodesMatch(
  nodeResults: unknown,
  comparisonNodes: unknown,
): boolean {
  if (!Array.isArray(nodeResults) || !Array.isArray(comparisonNodes)) {
    return false;
  }
  return nodeResults.every((result) => {
    if (
      !record(result) ||
      typeof result["nodeId"] !== "string" ||
      !workflowNodeStatus(result["status"]) ||
      (result["runId"] !== undefined && typeof result["runId"] !== "string") ||
      (result["outputSha256"] !== undefined && !hash(result["outputSha256"]))
    ) {
      return false;
    }
    const comparison = comparisonNodes.find(
      (candidate) =>
        record(candidate) && candidate["nodeId"] === result["nodeId"],
    );
    if (!record(comparison) || !record(comparison["target"])) return false;
    const target = comparison["target"];
    return (
      target["status"] === workflowNodeResultPlanStepStatus(result["status"]) &&
      target["outputSha256"] === result["outputSha256"] &&
      (result["runId"] === undefined ||
        (Array.isArray(target["runIds"]) &&
          target["runIds"].includes(result["runId"])))
    );
  });
}

function workflowNodeResultPlanStepStatus(input: unknown): unknown {
  if (input === "waiting") return "running";
  if (input === "cancelled") return "blocked";
  return input;
}

function workflowNodeStatus(input: unknown): boolean {
  return (
    input === "completed" ||
    input === "skipped" ||
    input === "waiting" ||
    input === "blocked" ||
    input === "cancelled"
  );
}

function planStepStatus(input: unknown): boolean {
  return (
    input === "pending" ||
    input === "ready" ||
    input === "running" ||
    input === "completed" ||
    input === "blocked" ||
    input === "skipped"
  );
}

function valueChange(input: unknown): boolean {
  return (
    input === "unchanged" ||
    input === "changed" ||
    input === "became_available" ||
    input === "became_unavailable" ||
    input === "unavailable"
  );
}
