import {
  RUN_EVENT_DEFINITION_GROUPS_V1,
  type EventCategory,
  type EventVisibility,
  type JsonObject,
  type JsonValue,
  type RegisteredRunEventInputFor,
  type RegisteredRunEventType,
  type RunEventDefinitionV1,
} from "@napier/contracts";

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
  admission?: RunEventAdmissionPolicy;
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
const COMPATIBILITY_BOUNDARIES = new Set([
  "legacy_import",
  "test_fixture",
]);

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
  return { ...input, visibility: input.visibility ?? "debug" };
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
    visibility: input.visibility ?? "debug",
    schemaVersion: input.schemaVersion ?? 1,
  };
}

function createRegistry(): Map<string, RunEventSchemaDefinition> {
  const registry = new Map<string, RunEventSchemaDefinition>();
  for (const group of RUN_EVENT_DEFINITION_GROUPS_V1) {
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
