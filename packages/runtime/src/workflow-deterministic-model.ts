import type {
  ExecutionPlanWorkflowDeterministicTemplate,
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  MAX_WORKFLOW_SCHEMA_PROPERTIES,
  resolveExecutionPlanWorkflowValuePath,
  validateExecutionPlanWorkflowValuePath,
  WORKFLOW_BINDING_NAME,
} from "./workflow-schemas.js";

const MAX_TEMPLATE_DEPTH = 8;
const MAX_TEMPLATE_NODES = 128;
const MAX_TEMPLATE_ARRAY_ITEMS = 128;
export const MAX_EXECUTION_PLAN_WORKFLOW_SWITCH_CASES = 16;
const MIN_EXECUTION_PLAN_WORKFLOW_SWITCH_CASES = 2;
const SWITCH_CASE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

type ExecutionPlanWorkflowDeterministicSwitchTemplate = Extract<
  ExecutionPlanWorkflowDeterministicTemplate,
  { kind: "switch" }
>;

export interface ExecutionPlanWorkflowDeterministicEvaluation {
  output: JsonValue;
  switchSelection?: {
    caseId: string;
    selectorSha256: string;
    defaultSelected: boolean;
  };
}

export class ExecutionPlanWorkflowSwitchUnmatchedError extends Error {
  constructor() {
    super("Workflow deterministic Switch has no matching case or default");
    this.name = "ExecutionPlanWorkflowSwitchUnmatchedError";
  }
}

export function validateExecutionPlanWorkflowDeterministicTemplate(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowDeterministicTemplate {
  assertWorkflowEncodedBytes(
    input,
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
    label,
  );
  return validateTemplate(input, label, 0, { nodes: 0 }, true);
}

export function validateExecutionPlanWorkflowDeterministicTemplateContract(
  input: unknown,
  inputSchema: WorkflowValueSchema,
  label: string,
): ExecutionPlanWorkflowDeterministicTemplate {
  const template = validateExecutionPlanWorkflowDeterministicTemplate(
    input,
    label,
  );
  if (template.kind !== "switch") return template;
  const selectorSchema = requiredSchemaAtPath(
    inputSchema,
    template.path,
    `${label} selector`,
  );
  for (const switchCase of template.cases) {
    assertWorkflowValue(
      selectorSchema,
      switchCase.equals,
      `${label} case ${switchCase.id}`,
    );
  }
  return template;
}

export function executeExecutionPlanWorkflowDeterministicTemplate(
  template: ExecutionPlanWorkflowDeterministicTemplate,
  input: JsonValue,
): JsonValue {
  return evaluateExecutionPlanWorkflowDeterministicTemplate(template, input)
    .output;
}

export function evaluateExecutionPlanWorkflowDeterministicTemplate(
  template: ExecutionPlanWorkflowDeterministicTemplate,
  input: JsonValue,
): ExecutionPlanWorkflowDeterministicEvaluation {
  const validated = validateExecutionPlanWorkflowDeterministicTemplate(
    template,
    "Workflow deterministic template",
  );
  return validated.kind === "switch"
    ? evaluateSwitch(validated, input)
    : { output: executeTemplate(validated, input, 0) };
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
  switchAllowed: boolean,
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
        false,
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
        validateTemplate(
          item,
          `${label}[${String(index)}]`,
          depth + 1,
          budget,
          false,
        ),
      ),
    };
  }
  if (template["kind"] === "switch") {
    if (!switchAllowed) {
      throw new Error(`${label} Switch is allowed only at the template root`);
    }
    assertExactKeys(
      template,
      ["kind", "path", "cases", "default"],
      label,
      new Set(["default"]),
    );
    const path = validateExecutionPlanWorkflowValuePath(
      template["path"],
      `${label} selector`,
    );
    if (
      !path ||
      !Array.isArray(template["cases"]) ||
      template["cases"].length < MIN_EXECUTION_PLAN_WORKFLOW_SWITCH_CASES ||
      template["cases"].length > MAX_EXECUTION_PLAN_WORKFLOW_SWITCH_CASES
    ) {
      throw new Error(`${label} Switch contract is invalid`);
    }
    const caseIds = new Set<string>();
    const caseValues = new Set<string>();
    const cases = template["cases"].map((caseInput, index) => {
      const caseLabel = `${label} case ${String(index + 1)}`;
      const switchCase = record(caseInput, caseLabel);
      assertExactKeys(switchCase, ["id", "equals", "then"], caseLabel);
      if (
        typeof switchCase["id"] !== "string" ||
        !SWITCH_CASE_ID.test(switchCase["id"]) ||
        switchCase["id"] === "default" ||
        caseIds.has(switchCase["id"])
      ) {
        throw new Error(`${caseLabel} ID is invalid`);
      }
      const equals = validateJsonValue(
        switchCase["equals"],
        `${caseLabel} equals`,
        depth + 1,
        budget,
      );
      const equalsJson = canonicalJson(equals);
      if (caseValues.has(equalsJson)) {
        throw new Error(`${label} Switch case values must be unique`);
      }
      caseIds.add(switchCase["id"]);
      caseValues.add(equalsJson);
      return {
        id: switchCase["id"],
        equals,
        then: validateTemplate(
          switchCase["then"],
          `${caseLabel} then`,
          depth + 1,
          budget,
          false,
        ),
      };
    });
    return {
      kind: "switch",
      path,
      cases,
      ...(template["default"] !== undefined
        ? {
            default: validateTemplate(
              template["default"],
              `${label} default`,
              depth + 1,
              budget,
              false,
            ),
          }
        : {}),
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
  if (template.kind === "switch") {
    return evaluateSwitch(template, input).output;
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

function evaluateSwitch(
  template: ExecutionPlanWorkflowDeterministicSwitchTemplate,
  input: JsonValue,
): ExecutionPlanWorkflowDeterministicEvaluation {
  const selector = resolveExecutionPlanWorkflowValuePath(
    input,
    template.path,
    "deterministic Switch selector",
  );
  const selectorJson = canonicalJson(selector);
  const matched = template.cases.find(
    (switchCase) => canonicalJson(switchCase.equals) === selectorJson,
  );
  if (!matched && template.default === undefined) {
    throw new ExecutionPlanWorkflowSwitchUnmatchedError();
  }
  return {
    output: executeTemplate(matched?.then ?? template.default!, input, 1),
    switchSelection: {
      caseId: matched?.id ?? "default",
      selectorSha256: sha256(selectorJson),
      defaultSelected: matched === undefined,
    },
  };
}

function requiredSchemaAtPath(
  inputSchema: WorkflowValueSchema,
  path: Array<string | number>,
  label: string,
): WorkflowValueSchema {
  let schema = inputSchema;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (schema.type !== "array" || (schema.minItems ?? 0) <= segment) {
        throw new Error(`${label} is not always available`);
      }
      schema = schema.items;
      continue;
    }
    if (
      schema.type !== "object" ||
      !schema.required.includes(segment) ||
      !Object.hasOwn(schema.properties, segment)
    ) {
      throw new Error(`${label} is not always available`);
    }
    schema = schema.properties[segment]!;
  }
  return schema;
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
