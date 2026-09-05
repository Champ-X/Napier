import {
  RUN_EVENT_DEFINITION_GROUPS_V1,
  type EventCategory,
  type EventVisibility,
  type JsonObject,
  type JsonValue,
  type RegisteredRunEventInputFor,
  type RegisteredRunEventType,
  type RunEventAdmissionPolicyV1,
  type RunEventDefinitionV1,
} from "@napier/contracts";

import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";

export type RunEventAdmissionPolicy = "run_active";

export type AppendEventInput<
  TType extends RegisteredRunEventType = RegisteredRunEventType,
> = RegisteredRunEventInputFor<TType> & {
  threadId: string;
  runId: string;
  admission?: RunEventAdmissionPolicy;
};

export interface AppendExtensionEventInput {
  threadId: string;
  runId: string;
  type: `extension.${string}`;
  category: "extension";
  visibility?: EventVisibility;
  payload: JsonObject;
  schemaVersion: number;
  extensionId: string;
  admission?: RunEventAdmissionPolicy;
}

export interface AppendCompatibilityEventInput {
  threadId: string;
  runId: string;
  type: string;
  category: EventCategory;
  visibility?: EventVisibility;
  payload: JsonValue;
  schemaVersion?: number;
  compatibility: {
    boundary: "legacy_import" | "test_fixture";
    reason: string;
  };
  admission?: RunEventAdmissionPolicy;
}

export interface ResolvedRunEventInput {
  threadId: string;
  runId: string;
  type: string;
  category: EventCategory;
  visibility: EventVisibility;
  payload: JsonValue;
  schemaVersion: number;
  admission: RunEventAdmissionPolicyV1;
}

export interface RunEventSchemaDefinition extends RunEventDefinitionV1 {
  type: RegisteredRunEventType;
  validate(payload: JsonValue): payload is JsonObject;
  upcast(schemaVersion: number, payload: JsonValue): JsonObject;
}

const REGISTRY = createRegistry();
const EVENT_CATEGORIES = new Set<EventCategory>([
  "lifecycle",
  "message",
  "model",
  "tool",
  "artifact",
  "goal",
  "plan",
  "memory",
  "subagent",
  "extension",
  "credential",
  "evaluation",
  "automation",
  "channel",
  "system",
]);
const EVENT_VISIBILITIES = new Set<EventVisibility>([
  "user",
  "debug",
  "hidden",
]);
const COMPATIBILITY_BOUNDARIES = new Set(["legacy_import", "test_fixture"]);

export function listRunEventSchemas(): RunEventSchemaDefinition[] {
  return [...REGISTRY.values()].map((definition) => ({
    ...definition,
    allowedVisibilities: [...definition.allowedVisibilities],
  }));
}

export function resolveRegisteredEventInput(
  input: AppendEventInput,
): ResolvedRunEventInput {
  const definition = REGISTRY.get(input.type);
  if (!definition)
    throw new Error(`Run event type is not registered: ${input.type}`);
  if (input.category !== definition.category) {
    throw new Error(
      `Run event ${input.type} category must be ${definition.category}`,
    );
  }
  const visibility = input.visibility ?? definition.defaultVisibility;
  if (!definition.allowedVisibilities.includes(visibility)) {
    throw new Error(
      `Run event ${input.type} visibility is not registered: ${visibility}`,
    );
  }
  const schemaVersion = input.schemaVersion ?? definition.schemaVersion;
  return {
    ...input,
    admission:
      definition.admission === "terminal_transition"
        ? definition.admission
        : (input.admission ?? definition.admission),
    visibility,
    schemaVersion: definition.schemaVersion,
    payload: definition.upcast(schemaVersion, input.payload),
  };
}

export function resolveExtensionEventInput(
  input: AppendExtensionEventInput,
): ResolvedRunEventInput {
  if (input.category !== "extension") {
    throw new Error("Extension event category must be extension");
  }
  if (
    !/^extension\.[a-z][a-z0-9_-]{0,63}\.[a-z][a-z0-9_.-]{0,127}$/u.test(
      input.type,
    )
  ) {
    throw new Error("Extension event type must identify its owner and event");
  }
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(input.extensionId)) {
    throw new Error("Extension event owner is invalid");
  }
  if (!input.type.startsWith(`extension.${input.extensionId}.`)) {
    throw new Error("Extension event type does not match its owner");
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error("Extension event schemaVersion is invalid");
  }
  assertEventVisibility(input.visibility, "Extension event");
  if (!isJsonObject(input.payload)) {
    throw new Error("Extension event payload must be a JSON object");
  }
  return {
    ...input,
    admission: input.admission ?? "run_any",
    visibility: input.visibility ?? "debug",
  };
}

export function resolveCompatibilityEventInput(
  input: AppendCompatibilityEventInput,
): ResolvedRunEventInput {
  if (
    !input.compatibility ||
    !COMPATIBILITY_BOUNDARIES.has(input.compatibility.boundary)
  ) {
    throw new Error("Compatibility event boundary is invalid");
  }
  if (
    typeof input.compatibility.reason !== "string" ||
    !input.compatibility.reason.trim()
  ) {
    throw new Error("Compatibility event reason is required");
  }
  if (typeof input.type !== "string" || !input.type.trim()) {
    throw new Error("Compatibility event type is required");
  }
  if (REGISTRY.has(input.type)) {
    throw new Error("Registered events must use the typed append path");
  }
  if (!EVENT_CATEGORIES.has(input.category)) {
    throw new Error("Compatibility event category is invalid");
  }
  assertEventVisibility(input.visibility, "Compatibility event");
  if (
    input.schemaVersion !== undefined &&
    (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1)
  ) {
    throw new Error("Compatibility event schemaVersion is invalid");
  }
  if (!isJsonValue(input.payload)) {
    throw new Error("Compatibility event payload must be JSON");
  }
  return {
    ...input,
    admission: input.admission ?? "run_any",
    visibility: input.visibility ?? "debug",
    schemaVersion: input.schemaVersion ?? 1,
  };
}

function createRegistry(): Map<string, RunEventSchemaDefinition> {
  const registry = new Map<string, RunEventSchemaDefinition>();
  for (const group of RUN_EVENT_DEFINITION_GROUPS_V1) {
    assertRunEventAdmissionPartition(group);
    const activeRunTypes = new Set<string>(group.activeRunTypes);
    const terminalTransitionTypes = new Set<string>(
      group.terminalTransitionTypes,
    );
    for (const type of group.types) {
      if (registry.has(type))
        throw new Error(`Duplicate Run event schema: ${type}`);
      const validate = payloadValidator(type);
      registry.set(type, {
        type,
        category: group.category,
        defaultVisibility: group.defaultVisibility,
        allowedVisibilities: group.allowedVisibilities,
        owner: group.owner,
        projectionOwner: group.projectionOwner,
        admission: activeRunTypes.has(type)
          ? "run_active"
          : terminalTransitionTypes.has(type)
            ? "terminal_transition"
            : "run_any",
        schemaVersion: group.schemaVersion,
        validate,
        upcast: (schemaVersion, payload) => {
          if (schemaVersion !== 1 || !validate(payload)) {
            throw new Error(
              `Run event ${type} payload v${String(schemaVersion)} is invalid`,
            );
          }
          return payload;
        },
      });
    }
  }
  return registry;
}

/**
 * Registered event groups must explicitly and exactly partition their event
 * types. This makes a newly registered authority event fail registry startup
 * unless its lifecycle policy was deliberately chosen.
 */
export function assertRunEventAdmissionPartition(group: {
  types: readonly string[];
  activeRunTypes: readonly string[];
  runAnyTypes: readonly string[];
  terminalTransitionTypes: readonly string[];
}): void {
  const types = uniqueEventTypes(group.types, "types");
  const active = uniqueEventTypes(group.activeRunTypes, "activeRunTypes");
  const runAny = uniqueEventTypes(group.runAnyTypes, "runAnyTypes");
  const terminalTransition = uniqueEventTypes(
    group.terminalTransitionTypes,
    "terminalTransitionTypes",
  );
  for (const type of active) {
    if (runAny.has(type) || terminalTransition.has(type)) {
      throw new Error(`Run event admission partition overlaps: ${type}`);
    }
  }
  for (const type of runAny) {
    if (terminalTransition.has(type)) {
      throw new Error(`Run event admission partition overlaps: ${type}`);
    }
  }
  for (const type of [...active, ...runAny, ...terminalTransition]) {
    if (!types.has(type)) {
      throw new Error(
        `Run event admission partition has unknown type: ${type}`,
      );
    }
  }
  for (const type of types) {
    if (
      !active.has(type) &&
      !runAny.has(type) &&
      !terminalTransition.has(type)
    ) {
      throw new Error(`Run event admission partition omits type: ${type}`);
    }
  }
}

function uniqueEventTypes(
  values: readonly string[],
  field: string,
): Set<string> {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`Run event admission partition duplicates ${field}`);
  }
  return unique;
}

function payloadValidator(
  type: RegisteredRunEventType,
): (payload: JsonValue) => payload is JsonObject {
  if (type === "message.user") {
    return (payload): payload is JsonObject =>
      isJsonObject(payload) &&
      payload["role"] === "user" &&
      typeof payload["text"] === "string";
  }
  if (type === "message.assistant") {
    return (payload): payload is JsonObject =>
      isJsonObject(payload) &&
      payload["role"] === "assistant" &&
      typeof payload["text"] === "string";
  }
  if (type === "run.progress.message") {
    return (payload): payload is JsonObject =>
      isJsonObject(payload) &&
      Object.keys(payload).every((key) =>
        [
          "sourceEventId",
          "model",
          "toolNames",
          "text",
          "contentRedacted",
        ].includes(key),
      ) &&
      typeof payload["sourceEventId"] === "string" &&
      payload["sourceEventId"].trim().length > 0 &&
      payload["sourceEventId"].length <= 256 &&
      typeof payload["model"] === "string" &&
      payload["model"].trim().length > 0 &&
      payload["model"].length <= 256 &&
      Array.isArray(payload["toolNames"]) &&
      payload["toolNames"].length > 0 &&
      payload["toolNames"].length <= 64 &&
      payload["toolNames"].every(
        (toolName) =>
          typeof toolName === "string" &&
          toolName.trim().length > 0 &&
          toolName.length <= 128,
      ) &&
      (payload["text"] === undefined ||
        (typeof payload["text"] === "string" &&
          payload["text"].trim().length > 0 &&
          payload["text"].length <= 4_000)) &&
      (payload["contentRedacted"] === undefined ||
        payload["contentRedacted"] === true) &&
      !(payload["contentRedacted"] === true && payload["text"] !== undefined);
  }
  if (
    type === "tool.started" ||
    type === "tool.completed" ||
    type === "tool.failed"
  ) {
    return (payload): payload is JsonObject =>
      isJsonObject(payload) &&
      typeof payload["callId"] === "string" &&
      typeof payload["toolName"] === "string";
  }
  if (
    type === "tool.operation.proposed" ||
    type === "tool.operation.admitted" ||
    type === "tool.operation.effect_indeterminate" ||
    type === "tool.operation.lease.granted" ||
    type === "tool.operation.lease.renewed" ||
    type === "tool.operation.started" ||
    type === "tool.operation.settled"
  ) {
    return (payload): payload is JsonObject =>
      validToolOperationEventPayload(type, payload);
  }
  return isJsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function isJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
  }
  ancestors.add(value);
  const valid = (Array.isArray(value) ? value : Object.values(value)).every(
    (item) => isJsonValue(item, ancestors),
  );
  ancestors.delete(value);
  return valid;
}

function assertEventVisibility(
  visibility: EventVisibility | undefined,
  label: string,
): void {
  if (visibility !== undefined && !EVENT_VISIBILITIES.has(visibility)) {
    throw new Error(`${label} visibility is invalid`);
  }
}
