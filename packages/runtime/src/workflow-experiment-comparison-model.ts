import type {
  ExecutionPlanWorkflowExperimentMetricSet,
  ExecutionPlanWorkflowExperimentNodeComparison,
  ExecutionPlanWorkflowExperimentValueChange,
} from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";

export const WORKFLOW_EXPERIMENT_METRIC_KEYS: Array<
  keyof ExecutionPlanWorkflowExperimentMetricSet
> = [
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
];

export function sumWorkflowExperimentMetrics(
  values: ExecutionPlanWorkflowExperimentMetricSet[],
): ExecutionPlanWorkflowExperimentMetricSet {
  const output = emptyWorkflowExperimentMetrics();
  for (const metrics of values) {
    for (const key of WORKFLOW_EXPERIMENT_METRIC_KEYS) {
      output[key] += metrics[key];
    }
  }
  return output;
}

export function subtractWorkflowExperimentMetrics(
  source: ExecutionPlanWorkflowExperimentMetricSet,
  target: ExecutionPlanWorkflowExperimentMetricSet,
): ExecutionPlanWorkflowExperimentMetricSet {
  return Object.fromEntries(
    WORKFLOW_EXPERIMENT_METRIC_KEYS.map((key) => [
      key,
      target[key] - source[key],
    ]),
  ) as unknown as ExecutionPlanWorkflowExperimentMetricSet;
}

export function emptyWorkflowExperimentMetrics(): ExecutionPlanWorkflowExperimentMetricSet {
  return {
    runCount: 0,
    attemptCount: 0,
    durationMs: 0,
    modelResponseCount: 0,
    toolCallCount: 0,
    toolCompletedCount: 0,
    toolFailedCount: 0,
    toolBlockedCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

export function workflowExperimentValueChange(
  source: string | undefined,
  target: string | undefined,
): ExecutionPlanWorkflowExperimentValueChange {
  if (!source && !target) return "unavailable";
  if (!source) return "became_available";
  if (!target) return "became_unavailable";
  return source === target ? "unchanged" : "changed";
}

export function workflowExperimentNodeChanged(
  node: ExecutionPlanWorkflowExperimentNodeComparison,
): boolean {
  return (
    node.statusChanged ||
    node.modelChanged ||
    node.configurationChanged ||
    node.inputChange === "changed" ||
    node.outputChange === "changed" ||
    node.inputChange === "became_available" ||
    node.inputChange === "became_unavailable" ||
    node.outputChange === "became_available" ||
    node.outputChange === "became_unavailable" ||
    node.addedToolNames.length > 0 ||
    node.removedToolNames.length > 0
  );
}

export function canonicalWorkflowExperimentStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function workflowExperimentConfigurationChanged(
  execution: "reused" | "rerun",
  sourceSha256s: string[],
  targetSha256s: string[],
): boolean {
  return (
    execution === "rerun" &&
    canonicalJson(canonicalWorkflowExperimentStrings(sourceSha256s)) !==
      canonicalJson(canonicalWorkflowExperimentStrings(targetSha256s))
  );
}
