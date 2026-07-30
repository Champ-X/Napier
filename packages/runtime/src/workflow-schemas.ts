import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowValuePathSegment,
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES = 32 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES = 32 * 1024;
export const MAX_WORKFLOW_SCHEMA_BYTES = 32 * 1024;
export const MAX_WORKFLOW_SCHEMA_PROPERTIES = 32;
export const WORKFLOW_BINDING_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
export const MAX_EXECUTION_PLAN_WORKFLOW_VALUE_PATH_DEPTH = 8;

const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_NODES = 128;
const MAX_SCHEMA_ARRAY_ITEMS = 256;
const MAX_SCHEMA_STRING_LENGTH = 16_384;
const MAX_SCHEMA_ENUM_VALUES = 32;
const FORBIDDEN_VALUE_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function workflowSchemaSha256(schema: WorkflowValueSchema): string {
  validateWorkflowSchema(schema, "Workflow schema", 0, { nodes: 0 });
  return sha256(canonicalJson(schema));
}

export function assertWorkflowValue(
  schema: WorkflowValueSchema,
  value: unknown,
  label: string,
  maximumBytes = MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
): asserts value is JsonValue {
  validateWorkflowSchema(schema, `${label} schema`, 0, { nodes: 0 });
  assertJsonValue(value, label);
  assertWorkflowEncodedBytes(value, maximumBytes, label);
  validateValueAgainstSchema(schema, value, label, 0);
}

export function assertWorkflowJsonValue(
  value: unknown,
  label: string,
  maximumBytes = MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
): asserts value is JsonValue {
  assertJsonValue(value, label);
  assertWorkflowEncodedBytes(value, maximumBytes, label);
}

export function buildExecutionPlanWorkflowNodeInput(
  node: ExecutionPlanWorkflowNode,
  workflowInput: JsonValue,
  nodeOutputs: ReadonlyMap<string, JsonValue>,
): JsonValue {
  const input: Record<string, JsonValue> = {};
  for (const [name, binding] of Object.entries(node.inputBindings)) {
    if (binding.source === "literal") {
      input[name] = structuredClone(binding.value);
      continue;
    }
    if (binding.source === "workflow") {
      input[name] = resolveExecutionPlanWorkflowValuePath(
        workflowInput,
        binding.path,
        `${node.id}.${name}`,
      );
      continue;
    }
    const output = nodeOutputs.get(binding.nodeId);
    if (output === undefined) {
      throw new Error(`Workflow dependency output is unavailable: ${node.id}`);
    }
    input[name] = resolveExecutionPlanWorkflowValuePath(
      output,
      binding.path,
      `${node.id}.${name}`,
    );
  }
  assertWorkflowEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
    `Workflow node input ${node.id}`,
  );
  assertWorkflowValue(
    node.inputSchema,
    input,
    `Workflow node input ${node.id}`,
  );
  return input;
}

export function workflowNodeBindingContextSha256(
  node: ExecutionPlanWorkflowNode,
  workflowInput: JsonValue,
  nodeOutputs: ReadonlyMap<string, JsonValue>,
): string {
  const dependencyOutputHashes = [
    ...new Set(
      Object.values(node.inputBindings).flatMap((binding) =>
        binding.source === "node" ? [binding.nodeId] : [],
      ),
    ),
  ]
    .sort((left, right) => left.localeCompare(right))
    .map((nodeId) => {
      const output = nodeOutputs.get(nodeId);
      return {
        nodeId,
        outputSha256: output === undefined ? "" : sha256(canonicalJson(output)),
      };
    });
  return sha256(
    canonicalJson({
      workflowInputSha256: sha256(canonicalJson(workflowInput)),
      dependencyOutputHashes,
    }),
  );
}

export function resolveExecutionPlanWorkflowValuePath(
  source: JsonValue,
  path: ExecutionPlanWorkflowValuePathSegment[] | undefined,
  label: string,
): JsonValue {
  if (!path || path.length === 0) return structuredClone(source);
  let value: JsonValue = source;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (
        !Array.isArray(value) ||
        !Number.isSafeInteger(segment) ||
        segment < 0 ||
        segment >= value.length
      ) {
        throw new Error(`Workflow binding path is unavailable: ${label}`);
      }
      value = value[segment]!;
      continue;
    }
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      !Object.hasOwn(value, segment)
    ) {
      throw new Error(`Workflow binding path is unavailable: ${label}`);
    }
    value = value[segment]!;
  }
  return structuredClone(value);
}

export function validateExecutionPlanWorkflowValuePath(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowValuePathSegment[] | undefined {
  if (input === undefined) return undefined;
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_EXECUTION_PLAN_WORKFLOW_VALUE_PATH_DEPTH
  ) {
    throw new Error(`${label} path is invalid`);
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
      WORKFLOW_BINDING_NAME.test(segment) &&
      !FORBIDDEN_VALUE_PATH_SEGMENTS.has(segment)
    ) {
      return segment;
    }
    throw new Error(`${label} path segment is invalid`);
  });
}

export function parseExecutionPlanWorkflowNodeOutput(
  text: string,
  schema: WorkflowValueSchema,
): JsonValue {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") >
      MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES
  ) {
    throw new Error("Workflow node output exceeds its byte limit");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Workflow node output is not strict JSON");
  }
  assertWorkflowValue(
    schema,
    value,
    "Workflow node output",
    MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  );
  return value;
}

export function validateWorkflowSchema(
  input: unknown,
  label: string,
  depth: number,
  budget: { nodes: number },
): WorkflowValueSchema {
  if (depth > MAX_SCHEMA_DEPTH || ++budget.nodes > MAX_SCHEMA_NODES) {
    throw new Error(`${label} exceeds the schema complexity limit`);
  }
  const schema = record(input, label);
  const type = schema["type"];
  if (type === "null" || type === "boolean") {
    assertExactKeys(schema, ["type"], label);
    return { type };
  }
  if (type === "number" || type === "integer") {
    assertExactKeys(
      schema,
      ["type", "minimum", "maximum"],
      label,
      new Set(["minimum", "maximum"]),
    );
    const minimum = optionalFiniteNumber(schema["minimum"], `${label} minimum`);
    const maximum = optionalFiniteNumber(schema["maximum"], `${label} maximum`);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      throw new Error(`${label} numeric bounds are invalid`);
    }
    return {
      type,
      ...(minimum !== undefined ? { minimum } : {}),
      ...(maximum !== undefined ? { maximum } : {}),
    };
  }
  if (type === "string") {
    assertExactKeys(
      schema,
      ["type", "minLength", "maxLength", "enum"],
      label,
      new Set(["minLength", "maxLength", "enum"]),
    );
    const minLength = optionalBoundedInteger(
      schema["minLength"],
      0,
      MAX_SCHEMA_STRING_LENGTH,
      `${label} minLength`,
    );
    const maxLength = optionalBoundedInteger(
      schema["maxLength"],
      0,
      MAX_SCHEMA_STRING_LENGTH,
      `${label} maxLength`,
    );
    if (
      minLength !== undefined &&
      maxLength !== undefined &&
      minLength > maxLength
    ) {
      throw new Error(`${label} string bounds are invalid`);
    }
    const values =
      schema["enum"] === undefined
        ? undefined
        : validateStringEnum(schema["enum"], label);
    return {
      type,
      ...(minLength !== undefined ? { minLength } : {}),
      ...(maxLength !== undefined ? { maxLength } : {}),
      ...(values ? { enum: values } : {}),
    };
  }
  if (type === "array") {
    assertExactKeys(
      schema,
      ["type", "items", "minItems", "maxItems"],
      label,
      new Set(["minItems", "maxItems"]),
    );
    const minItems = optionalBoundedInteger(
      schema["minItems"],
      0,
      MAX_SCHEMA_ARRAY_ITEMS,
      `${label} minItems`,
    );
    const maxItems = optionalBoundedInteger(
      schema["maxItems"],
      0,
      MAX_SCHEMA_ARRAY_ITEMS,
      `${label} maxItems`,
    );
    if (
      minItems !== undefined &&
      maxItems !== undefined &&
      minItems > maxItems
    ) {
      throw new Error(`${label} array bounds are invalid`);
    }
    return {
      type,
      items: validateWorkflowSchema(
        schema["items"],
        `${label} items`,
        depth + 1,
        budget,
      ),
      ...(minItems !== undefined ? { minItems } : {}),
      ...(maxItems !== undefined ? { maxItems } : {}),
    };
  }
  if (type !== "object") throw new Error(`${label} type is unsupported`);
  assertExactKeys(
    schema,
    ["type", "properties", "required", "additionalProperties"],
    label,
  );
  if (schema["additionalProperties"] !== false) {
    throw new Error(`${label} must deny additional properties`);
  }
  const propertiesInput = record(schema["properties"], `${label} properties`);
  const propertyEntries = Object.entries(propertiesInput);
  if (propertyEntries.length > MAX_WORKFLOW_SCHEMA_PROPERTIES) {
    throw new Error(`${label} has too many properties`);
  }
  const properties: Record<string, WorkflowValueSchema> = {};
  for (const [name, propertySchema] of propertyEntries) {
    if (!WORKFLOW_BINDING_NAME.test(name)) {
      throw new Error(`${label} property name is invalid`);
    }
    properties[name] = validateWorkflowSchema(
      propertySchema,
      `${label}.${name}`,
      depth + 1,
      budget,
    );
  }
  if (
    !Array.isArray(schema["required"]) ||
    schema["required"].some(
      (name) => typeof name !== "string" || !(name in properties),
    ) ||
    new Set(schema["required"]).size !== schema["required"].length
  ) {
    throw new Error(`${label} required properties are invalid`);
  }
  return {
    type,
    properties,
    required: [...schema["required"]] as string[],
    additionalProperties: false,
  };
}

export function assertWorkflowEncodedBytes(
  input: unknown,
  maximum: number,
  label: string,
): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    throw new Error(`${label} is not serializable JSON`);
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > maximum) {
    throw new Error(`${label} exceeds its byte limit`);
  }
}

function validateValueAgainstSchema(
  schema: WorkflowValueSchema,
  value: JsonValue,
  label: string,
  depth: number,
): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(`${label} exceeds the value depth limit`);
  }
  if (schema.type === "null") {
    if (value !== null) throw new Error(`${label} does not match its schema`);
    return;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`${label} does not match its schema`);
    }
    return;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum)
    ) {
      throw new Error(`${label} does not match its schema`);
    }
    return;
  }
  if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      (schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.enum !== undefined && !schema.enum.includes(value))
    ) {
      throw new Error(`${label} does not match its schema`);
    }
    return;
  }
  if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    ) {
      throw new Error(`${label} does not match its schema`);
    }
    value.forEach((item, index) =>
      validateValueAgainstSchema(
        schema.items,
        item,
        `${label}[${String(index)}]`,
        depth + 1,
      ),
    );
    return;
  }
  if (!("properties" in schema)) {
    throw new Error(`${label} does not match its schema`);
  }
  if (!isRecord(value)) throw new Error(`${label} does not match its schema`);
  const keys = Object.keys(value);
  if (
    keys.some((key) => !(key in schema.properties)) ||
    schema.required.some((key) => !(key in value))
  ) {
    throw new Error(`${label} does not match its schema`);
  }
  for (const [key, item] of Object.entries(value)) {
    validateValueAgainstSchema(
      schema.properties[key]!,
      item,
      `${label}.${key}`,
      depth + 1,
    );
  }
}

function assertJsonValue(
  value: unknown,
  label: string,
  depth = 0,
): asserts value is JsonValue {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new Error(`${label} exceeds the value depth limit`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_SCHEMA_ARRAY_ITEMS) {
      throw new Error(`${label} exceeds the array limit`);
    }
    value.forEach((item) => assertJsonValue(item, label, depth + 1));
    return;
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length > MAX_WORKFLOW_SCHEMA_PROPERTIES
  ) {
    throw new Error(`${label} is not bounded JSON`);
  }
  Object.values(value).forEach((item) =>
    assertJsonValue(item, label, depth + 1),
  );
}

function validateStringEnum(input: unknown, label: string): string[] {
  if (
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > MAX_SCHEMA_ENUM_VALUES ||
    input.some(
      (value) =>
        typeof value !== "string" || value.length > MAX_SCHEMA_STRING_LENGTH,
    ) ||
    new Set(input).size !== input.length
  ) {
    throw new Error(`${label} enum is invalid`);
  }
  return [...input] as string[];
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  optional = new Set<string>(),
): void {
  const allowed = new Set(keys);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    keys.some((key) => !optional.has(key) && !(key in value))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!isRecord(input)) throw new Error(`${label} must be an object`);
  return input;
}

function isRecord(input: unknown): input is Record<string, JsonValue> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function boundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(input) ||
    Number(input) < minimum ||
    Number(input) > maximum
  ) {
    throw new Error(`${label} must be ${minimum}-${maximum}`);
  }
  return Number(input);
}

function optionalBoundedInteger(
  input: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | undefined {
  return input === undefined
    ? undefined
    : boundedInteger(input, minimum, maximum, label);
}

function optionalFiniteNumber(
  input: unknown,
  label: string,
): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new Error(`${label} is invalid`);
  }
  return input;
}
