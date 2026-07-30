import type {
  ExecutionPlanWorkflowDeterministicTemplate,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowEncodedBytes,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  MAX_WORKFLOW_SCHEMA_PROPERTIES,
  resolveExecutionPlanWorkflowValuePath,
  validateExecutionPlanWorkflowValuePath,
  WORKFLOW_BINDING_NAME,
} from "./workflow-schemas.js";

const MAX_TEMPLATE_DEPTH = 8;
const MAX_TEMPLATE_NODES = 128;
const MAX_TEMPLATE_ARRAY_ITEMS = 128;

export function validateExecutionPlanWorkflowDeterministicTemplate(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowDeterministicTemplate {
  assertWorkflowEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
    label,
  );
  return validateTemplate(input, label, 0, { nodes: 0 });
}

export function executeExecutionPlanWorkflowDeterministicTemplate(
  template: ExecutionPlanWorkflowDeterministicTemplate,
  input: JsonValue,
): JsonValue {
  const validated = validateExecutionPlanWorkflowDeterministicTemplate(
    template,
    "Workflow deterministic template",
  );
  return executeTemplate(validated, input, 0);
}

export function executionPlanWorkflowDeterministicTemplateSha256(
  template: ExecutionPlanWorkflowDeterministicTemplate,
): string {
  return sha256(
    canonicalJson(
      validateExecutionPlanWorkflowDeterministicTemplate(
        template,
        "Workflow deterministic template",
      ),
    ),
  );
}

function validateTemplate(
  input: unknown,
  label: string,
  depth: number,
  budget: { nodes: number },
): ExecutionPlanWorkflowDeterministicTemplate {
  if (depth > MAX_TEMPLATE_DEPTH || ++budget.nodes > MAX_TEMPLATE_NODES) {
    throw new Error(`${label} exceeds the template complexity limit`);
  }
  const template = record(input, label);
  if (template["kind"] === "literal") {
    assertExactKeys(template, ["kind", "value"], label);
    return {
      kind: "literal",
      value: validateJsonValue(
        template["value"],
        `${label} literal`,
        depth + 1,
        budget,
      ),
    };
  }
  if (template["kind"] === "input") {
    assertExactKeys(template, ["kind", "path"], label, new Set(["path"]));
    const path = validateExecutionPlanWorkflowValuePath(
      template["path"],
      label,
    );
    return {
      kind: "input",
      ...(path ? { path } : {}),
    };
  }
  if (template["kind"] === "object") {
    assertExactKeys(template, ["kind", "properties"], label);
    const propertiesInput = record(
      template["properties"],
      `${label} properties`,
    );
    const entries = Object.entries(propertiesInput);
    if (entries.length > MAX_WORKFLOW_SCHEMA_PROPERTIES) {
      throw new Error(`${label} has too many properties`);
    }
    const properties: Record<
      string,
      ExecutionPlanWorkflowDeterministicTemplate
    > = {};
    for (const [name, value] of entries) {
      if (!WORKFLOW_BINDING_NAME.test(name)) {
        throw new Error(`${label} property name is invalid`);
      }
      properties[name] = validateTemplate(
        value,
        `${label}.${name}`,
        depth + 1,
        budget,
      );
    }
    return { kind: "object", properties };
  }
  if (template["kind"] === "array") {
    assertExactKeys(template, ["kind", "items"], label);
    if (
      !Array.isArray(template["items"]) ||
      template["items"].length > MAX_TEMPLATE_ARRAY_ITEMS
    ) {
      throw new Error(`${label} items are invalid`);
    }
    return {
      kind: "array",
      items: template["items"].map((item, index) =>
        validateTemplate(item, `${label}[${String(index)}]`, depth + 1, budget),
      ),
    };
  }
  throw new Error(`${label} kind is unsupported`);
}

function executeTemplate(
  template: ExecutionPlanWorkflowDeterministicTemplate,
  input: JsonValue,
  depth: number,
): JsonValue {
  if (depth > MAX_TEMPLATE_DEPTH) {
    throw new Error("Workflow deterministic template exceeds its depth limit");
  }
  if (template.kind === "literal") {
    return structuredClone(template.value);
  }
  if (template.kind === "input") {
    return resolveExecutionPlanWorkflowValuePath(
      input,
      template.path,
      "deterministic template",
    );
  }
  if (template.kind === "array") {
    return template.items.map((item) =>
      executeTemplate(item, input, depth + 1),
    );
  }
  return Object.fromEntries(
    Object.entries(template.properties).map(([name, value]) => [
      name,
      executeTemplate(value, input, depth + 1),
    ]),
  );
}

function validateJsonValue(
  input: unknown,
  label: string,
  depth: number,
  budget: { nodes: number },
): JsonValue {
  if (depth > MAX_TEMPLATE_DEPTH || ++budget.nodes > MAX_TEMPLATE_NODES) {
    throw new Error(`${label} exceeds the value complexity limit`);
  }
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "boolean"
  ) {
    return input;
  }
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (Array.isArray(input)) {
    if (input.length > MAX_TEMPLATE_ARRAY_ITEMS) {
      throw new Error(`${label} has too many items`);
    }
    return input.map((item, index) =>
      validateJsonValue(item, `${label}[${String(index)}]`, depth + 1, budget),
    );
  }
  if (
    !input ||
    typeof input !== "object" ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error(`${label} is not JSON`);
  }
  const entries = Object.entries(input);
  if (
    entries.length > MAX_WORKFLOW_SCHEMA_PROPERTIES ||
    entries.some(([name]) => !WORKFLOW_BINDING_NAME.test(name))
  ) {
    throw new Error(`${label} object is invalid`);
  }
  return Object.fromEntries(
    entries.map(([name, value]) => [
      name,
      validateJsonValue(value, `${label}.${name}`, depth + 1, budget),
    ]),
  );
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
    keys.some((key) => !optional.has(key) && !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

function record(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}
