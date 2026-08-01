import type {
  ExecutionPlanWorkflowExperimentToolEffects,
  ExecutionPlanWorkflowManifest,
  RunEvent,
} from "@napier/contracts";

import { collectRunToolEffectObservations } from "./automatic-recovery.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { executionPlanWorkflowConditionSha256 } from "./workflow-condition-model.js";
import { executionPlanWorkflowDeterministicTemplateSha256 } from "./workflow-deterministic-model.js";
import { workflowLoopNodeConfigurationSha256 } from "./workflow-loop-model.js";
import { workflowMapNodeConfigurationSha256 } from "./workflow-map-model.js";
import { workflowReduceConfigurationSha256 } from "./workflow-reduce-model.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";

export function experimentNodeToolEffects(
  events: RunEvent[],
  planId: string,
  nodeId: string,
): ExecutionPlanWorkflowExperimentToolEffects {
  const started = events.filter(
    (event) =>
      event.type === "workflow.node.started" &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  const runIds = [...new Set(started.map((event) => event.runId))];
  const mapItemRunIds = events
    .filter(
      (event) =>
        event.type === "workflow.map.item.started" &&
        record(event.payload)?.["planId"] === planId &&
        record(event.payload)?.["nodeId"] === nodeId,
    )
    .map((event) => event.runId);
  const loopIterationRunIds = events
    .filter(
      (event) =>
        event.type === "workflow.loop.iteration.started" &&
        record(event.payload)?.["planId"] === planId &&
        record(event.payload)?.["nodeId"] === nodeId,
    )
    .map((event) => event.runId);
  const observationRunIds = [
    ...new Set([...runIds, ...mapItemRunIds, ...loopIterationRunIds]),
  ];
  const observations = observationRunIds.flatMap((runId) =>
    collectRunToolEffectObservations(
      events.filter((event) => event.runId === runId),
    ),
  );
  const writeToolNames = canonicalNames(
    observations
      .filter((observation) => observation.effect === "write")
      .map((observation) => observation.toolName),
  );
  const unknownToolNames = canonicalNames(
    observations
      .filter(
        (observation) =>
          observation.effect === "unknown" || observation.unresolved,
      )
      .map((observation) => observation.toolName),
  );
  return {
    nodeId,
    attemptCount: started.length,
    toolCallCount: observations.length,
    readOnlyCount: observations.filter(
      (observation) => observation.effect === "read",
    ).length,
    writeCount: observations.filter(
      (observation) => observation.effect === "write",
    ).length,
    unknownCount: observations.filter(
      (observation) => observation.effect === "unknown",
    ).length,
    unresolvedCount: observations.filter(
      (observation) => observation.unresolved,
    ).length,
    writeToolNames,
    unknownToolNames,
  };
}

export function matchingNodeEvent(
  events: RunEvent[],
  type: string,
  planId: string,
  nodeId: string,
  runId: string,
): RunEvent {
  const matches = events.filter(
    (event) =>
      event.type === type &&
      event.runId === runId &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  if (matches.length !== 1) {
    throw new Error(`Workflow experiment source ${type} evidence is ambiguous`);
  }
  return matches[0]!;
}

export function validateSourceStartedEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  inputSha256: string,
  reused: boolean,
): number {
  const payload = record(event.payload);
  const attempt = payload?.["attempt"];
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["inputSchemaSha256"] !== workflowSchemaSha256(node.inputSchema) ||
    payload["outputSchemaSha256"] !== workflowSchemaSha256(node.outputSchema) ||
    !sourceNodeMetadataMatches(node, payload) ||
    !Number.isSafeInteger(attempt) ||
    Number(attempt) < 1 ||
    Number(attempt) > node.maxAttempts ||
    Boolean(payload["reused"]) !== reused
  ) {
    throw new Error("Workflow experiment source start evidence mismatch");
  }
  return Number(attempt);
}

export function validateSourceCompletedEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  attempt: number,
  inputSha256: string,
  outputSha256: string,
  reused: boolean,
): void {
  const payload = record(event.payload);
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["attempt"] !== attempt ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["inputSchemaSha256"] !== workflowSchemaSha256(node.inputSchema) ||
    payload["outputSchemaSha256"] !== workflowSchemaSha256(node.outputSchema) ||
    !sourceNodeMetadataMatches(node, payload) ||
    typeof payload["recovered"] !== "boolean" ||
    Boolean(payload["reused"]) !== reused
  ) {
    throw new Error("Workflow experiment source completion evidence mismatch");
  }
}

export function validateSourceReuseEvent(
  event: RunEvent,
  sourceManifestSha256: string,
  inputSha256: string,
  outputSha256: string,
): void {
  const payload = record(event.payload);
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["sourceInputSha256"] !== inputSha256 ||
    typeof payload["sourceThreadId"] !== "string" ||
    typeof payload["sourcePlanId"] !== "string" ||
    typeof payload["sourceRunId"] !== "string" ||
    !Number.isSafeInteger(payload["sourceAttempt"]) ||
    Number(payload["sourceAttempt"]) < 1
  ) {
    throw new Error("Workflow experiment source reuse evidence mismatch");
  }
}

export function validateSourceSkippedReuseEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  sourceManifestSha256: string,
  inputSha256: string,
  outputSha256: string,
): void {
  const matches = events.filter(
    (event) =>
      event.type === "workflow.node.reused" &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
  const payload =
    matches.length === 1 ? record(matches[0]!.payload) : undefined;
  if (
    payload?.["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== sourceManifestSha256 ||
    payload["inputSha256"] !== inputSha256 ||
    payload["outputSha256"] !== outputSha256 ||
    payload["sourceInputSha256"] !== inputSha256 ||
    payload["sourceStatus"] !== "skipped" ||
    payload["sourceAttempt"] !== 0 ||
    payload["sourceRunId"] !== undefined ||
    typeof payload["sourceThreadId"] !== "string" ||
    typeof payload["sourcePlanId"] !== "string"
  ) {
    throw new Error("Workflow experiment source skipped reuse mismatch");
  }
}

function sourceNodeMetadataMatches(
  node: ExecutionPlanWorkflowManifest["nodes"][number],
  payload: Record<string, unknown>,
): boolean {
  if (
    node.when
      ? payload["conditionSha256"] !==
          executionPlanWorkflowConditionSha256(node.when) ||
        payload["skipOutputSha256"] !== sha256(canonicalJson(node.skipOutput!))
      : payload["conditionSha256"] !== undefined ||
        payload["skipOutputSha256"] !== undefined
  ) {
    return false;
  }
  if (node.type === "tool") {
    return (
      payload["nodeType"] === "tool" &&
      payload["toolName"] === node.tool &&
      payload["effect"] === node.effect
    );
  }
  if (node.type === "approval") {
    return (
      payload["nodeType"] === "approval" &&
      payload["questionSha256"] === sha256(node.question)
    );
  }
  if (node.type === "deterministic") {
    return (
      payload["nodeType"] === "deterministic" &&
      payload["templateSha256"] ===
        executionPlanWorkflowDeterministicTemplateSha256(node.template)
    );
  }
  if (node.type === "map") {
    return (
      payload["nodeType"] === "map" &&
      payload["mapConfigurationSha256"] ===
        workflowMapNodeConfigurationSha256(node)
    );
  }
  if (node.type === "loop") {
    return (
      payload["nodeType"] === "loop" &&
      payload["loopConfigurationSha256"] ===
        workflowLoopNodeConfigurationSha256(node)
    );
  }
  if (node.type === "reduce") {
    return (
      payload["nodeType"] === "reduce" &&
      payload["reduceConfigurationSha256"] ===
        workflowReduceConfigurationSha256(node)
    );
  }
  return payload["nodeType"] === undefined || payload["nodeType"] === "agent";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canonicalNames(values: string[]): string[] {
  return [...new Set(values)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 64);
}
