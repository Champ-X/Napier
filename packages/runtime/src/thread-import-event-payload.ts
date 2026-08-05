import type { JsonValue, RunEvent } from "@napier/contracts";

import { WORKFLOW_NODE_INPUT_REPLACEMENT_REQUESTED_EVENT } from "./workflow-input-override.js";
import { WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT } from "./workflow-simulation-evidence.js";

export function dropPrivateImportedEvent(event: RunEvent): boolean {
  return (
    event.type !== "context.research_sources" &&
    event.type !== "context.web_fetch_sources"
  );
}

export function remapImportedEventPayload(
  type: string,
  payload: JsonValue,
  idMap: ReadonlyMap<string, string>,
): JsonValue {
  if (type === "run.started" && record(payload)) {
    const cloned = structuredClone(payload);
    delete cloned["sourceContinuityRunId"];
    return remapJsonValue(cloned, idMap);
  }
  if (type === "tool.completed" && privateToolCapsulePayload(payload)) {
    const cloned = structuredClone(payload);
    const details = cloned["details"] as Record<string, JsonValue>;
    delete details["stateCapsule"];
    return remapJsonValue(cloned, idMap);
  }
  const simulationOutput =
    type === WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT &&
    record(payload) &&
    Object.hasOwn(payload, "output")
      ? structuredClone(payload["output"])
      : undefined;
  const replacementInput =
    type === WORKFLOW_NODE_INPUT_REPLACEMENT_REQUESTED_EVENT &&
    record(payload) &&
    Object.hasOwn(payload, "input")
      ? structuredClone(payload["input"])
      : undefined;
  const remapped = remapJsonValue(payload, idMap);
  if (
    simulationOutput !== undefined &&
    record(remapped) &&
    Object.hasOwn(remapped, "output")
  ) {
    remapped["output"] = simulationOutput;
  }
  if (
    replacementInput !== undefined &&
    record(remapped) &&
    Object.hasOwn(remapped, "input")
  ) {
    remapped["input"] = replacementInput;
  }
  return remapped;
}

function privateToolCapsulePayload(value: JsonValue): value is Record<
  string,
  JsonValue
> & {
  details: Record<string, JsonValue>;
} {
  return (
    record(value) &&
    (value["toolName"] === "research_source" ||
      value["toolName"] === "web_fetch") &&
    record(value["details"])
  );
}

function remapJsonValue(
  value: JsonValue,
  idMap: ReadonlyMap<string, string>,
): JsonValue {
  if (typeof value === "string") return idMap.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => remapJsonValue(item, idMap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        remapJsonValue(item, idMap),
      ]),
    );
  }
  return value;
}

function record(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
