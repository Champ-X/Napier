import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowValuePathSegment,
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertJsonValue,
  validateValueAgainstSchema,
  validateWorkflowSchema,
  WORKFLOW_BINDING_NAME,
} from "./workflow-schema-validation.js";

export {
  MAX_WORKFLOW_SCHEMA_PROPERTIES,
  validateWorkflowSchema,
  WORKFLOW_BINDING_NAME,
} from "./workflow-schema-validation.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES = 32 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES = 32 * 1024;
export const MAX_WORKFLOW_SCHEMA_BYTES = 32 * 1024;
export const MAX_EXECUTION_PLAN_WORKFLOW_VALUE_PATH_DEPTH = 8;
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
  inputOverride?: JsonValue,
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
  const content = {
    workflowInputSha256: sha256(canonicalJson(workflowInput)),
    dependencyOutputHashes,
  };
  return sha256(
    canonicalJson(
      inputOverride === undefined
        ? content
        : {
            ...content,
            inputOverrideSha256: sha256(canonicalJson(inputOverride)),
          },
    ),
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

export function resolveExecutionPlanWorkflowSchemaPath(
  source: WorkflowValueSchema,
  path: ExecutionPlanWorkflowValuePathSegment[] | undefined,
  label: string,
): WorkflowValueSchema {
  if (!path || path.length === 0) return structuredClone(source);
  let schema = source;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (schema.type !== "array") {
        throw new Error(`Workflow schema path is unavailable: ${label}`);
      }
      schema = schema.items;
      continue;
    }
    if (
      schema.type !== "object" ||
      !("properties" in schema) ||
      !Object.hasOwn(schema.properties, segment)
    ) {
      throw new Error(`Workflow schema path is unavailable: ${label}`);
    }
    schema = schema.properties[segment]!;
  }
  return structuredClone(schema);
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
