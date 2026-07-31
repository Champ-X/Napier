import type {
  ExecutionPlanWorkflowMapNode,
  JsonValue,
  RunEvent,
  RunRecord,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  workflowMapItemContext,
  workflowMapItemInputSha256,
  workflowMapItems,
  workflowMapNodeConfigurationSha256,
} from "./workflow-map-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_MAP_ITEM_STARTED_EVENT = "workflow.map.item.started";
export const WORKFLOW_MAP_ITEM_COMPLETED_EVENT = "workflow.map.item.completed";
export const WORKFLOW_MAP_ITEM_FAILED_EVENT = "workflow.map.item.failed";
export const WORKFLOW_MAP_COMPLETED_EVENT = "workflow.map.completed";

export function hasWorkflowMapCompletionEvent(
  events: RunEvent[],
  planId: string,
  nodeId: string,
  runId: string,
): boolean {
  return events.some(
    (event) =>
      event.runId === runId &&
      event.type === WORKFLOW_MAP_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId,
  );
}

export function readWorkflowMapOutputEvidence(options: {
  events: RunEvent[];
  runs: RunRecord[];
  node: ExecutionPlanWorkflowMapNode;
  runId: string;
  planId: string;
  manifestSha256: string;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  assistantOutput: string;
}): JsonValue[] {
  const completions = options.events.filter(
    (event) =>
      event.runId === options.runId &&
      event.type === WORKFLOW_MAP_COMPLETED_EVENT &&
      record(event.payload)?.["planId"] === options.planId &&
      record(event.payload)?.["nodeId"] === options.node.id,
  );
  const payload =
    completions.length === 1 ? record(completions[0]?.payload) : undefined;
  const output = parseExecutionPlanWorkflowNodeOutput(
    options.assistantOutput,
    options.node.outputSchema,
  );
  if (!Array.isArray(output)) {
    throw new Error("Workflow Map output evidence is invalid");
  }
  const serializedOutput = canonicalJson(output);
  const items = workflowMapItems(options.node, options.input);
  const starts = mapItemEvents(
    options.events,
    WORKFLOW_MAP_ITEM_STARTED_EVENT,
    options.planId,
    options.node.id,
    options.runId,
  );
  const itemCompletions = mapItemEvents(
    options.events,
    WORKFLOW_MAP_ITEM_COMPLETED_EVENT,
    options.planId,
    options.node.id,
    options.runId,
  );
  if (
    !payload ||
    payload["schemaVersion"] !== 1 ||
    payload["manifestSha256"] !== options.manifestSha256 ||
    payload["attempt"] !== options.attempt ||
    payload["mapConfigurationSha256"] !==
      workflowMapNodeConfigurationSha256(options.node) ||
    payload["inputSha256"] !== options.inputSha256 ||
    payload["outputSha256"] !== sha256(serializedOutput) ||
    payload["outputBytes"] !== Buffer.byteLength(serializedOutput, "utf8") ||
    payload["outputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema) ||
    payload["itemOutputSchemaSha256"] !==
      workflowSchemaSha256(options.node.outputSchema.items) ||
    payload["itemCount"] !== items.length ||
    payload["maxConcurrency"] !== options.node.maxConcurrency ||
    starts.length !== items.length ||
    itemCompletions.length !== items.length ||
    output.length !== items.length
  ) {
    throw new Error("Workflow Map output evidence is unavailable");
  }
  const runById = new Map(options.runs.map((run) => [run.id, run]));
  const coordinator = runById.get(options.runId);
  if (!coordinator?.configuration) {
    throw new Error("Workflow Map coordinator evidence is unavailable");
  }
  const itemInputHashes: string[] = [];
  const itemOutputHashes: string[] = [];
  const itemRunIds: string[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const started = starts.find(
      (event) => record(event.payload)?.["itemIndex"] === index,
    );
    const completed = itemCompletions.find(
      (event) => record(event.payload)?.["itemIndex"] === index,
    );
    const startedPayload = record(started?.payload);
    const completedPayload = record(completed?.payload);
    if (
      !started ||
      !completed ||
      started.runId !== completed.runId ||
      !startedPayload ||
      !completedPayload
    ) {
      throw new Error("Workflow Map item evidence is ambiguous");
    }
    const itemContext = workflowMapItemContext(
      options.node,
      options.input,
      items[index]!,
      index,
      items.length,
    );
    const itemInputSha256 = workflowMapItemInputSha256(
      options.inputSha256,
      itemContext,
    );
    const childOutput = parseExecutionPlanWorkflowNodeOutput(
      assistantText(options.events, started.runId),
      options.node.outputSchema.items,
    );
    const itemOutputSha256 = sha256(canonicalJson(childOutput));
    const run = runById.get(started.runId);
    if (
      !run ||
      run.parentRunId !== options.runId ||
      run.workflowPlanId !== options.planId ||
      run.agentId !== coordinator.agentId ||
      run.agentRevision !== coordinator.agentRevision ||
      run.source !== "workflow" ||
      run.status !== "completed" ||
      !run.configuration ||
      run.configuration.schemaVersion === 1 ||
      run.configuration.executionMode !== "workflow_map_read_only" ||
      run.configuration.model.provider !==
        coordinator.configuration.model.provider ||
      run.configuration.model.id !== coordinator.configuration.model.id ||
      startedPayload["schemaVersion"] !== 1 ||
      startedPayload["manifestSha256"] !== options.manifestSha256 ||
      startedPayload["attempt"] !== options.attempt ||
      startedPayload["itemCount"] !== items.length ||
      startedPayload["itemInputSha256"] !== itemInputSha256 ||
      startedPayload["itemOutputSchemaSha256"] !==
        workflowSchemaSha256(options.node.outputSchema.items) ||
      startedPayload["mapConfigurationSha256"] !==
        workflowMapNodeConfigurationSha256(options.node) ||
      completedPayload["schemaVersion"] !== 1 ||
      completedPayload["manifestSha256"] !== options.manifestSha256 ||
      completedPayload["attempt"] !== options.attempt ||
      completedPayload["itemCount"] !== items.length ||
      completedPayload["itemInputSha256"] !== itemInputSha256 ||
      completedPayload["itemOutputSha256"] !== itemOutputSha256 ||
      completedPayload["itemOutputBytes"] !==
        Buffer.byteLength(canonicalJson(childOutput), "utf8") ||
      completedPayload["itemOutputSchemaSha256"] !==
        workflowSchemaSha256(options.node.outputSchema.items) ||
      completedPayload["mapConfigurationSha256"] !==
        workflowMapNodeConfigurationSha256(options.node) ||
      canonicalJson(childOutput) !== canonicalJson(output[index])
    ) {
      throw new Error("Workflow Map item evidence mismatch");
    }
    itemInputHashes.push(itemInputSha256);
    itemOutputHashes.push(itemOutputSha256);
    itemRunIds.push(started.runId);
  }
  if (
    payload["itemInputSetSha256"] !== sha256(canonicalJson(itemInputHashes)) ||
    payload["itemOutputSetSha256"] !==
      sha256(canonicalJson(itemOutputHashes)) ||
    payload["itemRunSetSha256"] !== sha256(canonicalJson(itemRunIds))
  ) {
    throw new Error("Workflow Map item-set evidence mismatch");
  }
  return output.map((item) => structuredClone(item));
}

export function workflowMapNodeMetadata(
  node: ExecutionPlanWorkflowMapNode,
): Record<string, JsonValue> {
  return {
    nodeType: "map",
    mapConfigurationSha256: workflowMapNodeConfigurationSha256(node),
  };
}

export function workflowMapNodeMetadataMatches(
  node: ExecutionPlanWorkflowMapNode,
  payload: Record<string, JsonValue>,
): boolean {
  return (
    payload["nodeType"] === "map" &&
    payload["mapConfigurationSha256"] ===
      workflowMapNodeConfigurationSha256(node)
  );
}

function mapItemEvents(
  events: RunEvent[],
  type: string,
  planId: string,
  nodeId: string,
  coordinatorRunId: string,
): RunEvent[] {
  return events.filter(
    (event) =>
      event.type === type &&
      record(event.payload)?.["planId"] === planId &&
      record(event.payload)?.["nodeId"] === nodeId &&
      record(event.payload)?.["coordinatorRunId"] === coordinatorRunId,
  );
}

function assistantText(events: RunEvent[], runId: string): string {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.runId === runId &&
        candidate.type === "message.assistant" &&
        typeof record(candidate.payload)?.["text"] === "string",
    );
  const text = record(event?.payload)?.["text"];
  if (typeof text !== "string") {
    throw new Error("Workflow Map item output is unavailable");
  }
  return text;
}

function record(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}
