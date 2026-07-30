import type {
  ExecutionPlanWorkflowCondition,
  JsonValue,
  WorkflowValueSchema,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowJsonValue,
  resolveExecutionPlanWorkflowValuePath,
  validateExecutionPlanWorkflowValuePath,
} from "./workflow-schemas.js";

export interface ExecutionPlanWorkflowConditionEvaluation {
  matched: boolean;
  subjectSha256: string;
}

export function validateExecutionPlanWorkflowCondition(
  input: unknown,
  label: string,
): ExecutionPlanWorkflowCondition {
  const condition = record(input, label);
  assertExactKeys(condition, ["path", "equals"], label);
  const path = validateExecutionPlanWorkflowValuePath(condition["path"], label);
  if (!path) throw new Error(`${label} path is invalid`);
  assertWorkflowJsonValue(condition["equals"], `${label} equals`);
  return {
    path,
    equals: structuredClone(condition["equals"]),
  };
}

export function evaluateExecutionPlanWorkflowCondition(
  condition: ExecutionPlanWorkflowCondition,
  nodeInput: JsonValue,
  label: string,
): ExecutionPlanWorkflowConditionEvaluation {
  const subject = resolveExecutionPlanWorkflowValuePath(
    nodeInput,
    condition.path,
    label,
  );
  return {
    matched: canonicalJson(subject) === canonicalJson(condition.equals),
    subjectSha256: sha256(canonicalJson(subject)),
  };
}

export function executionPlanWorkflowConditionSha256(
  condition: ExecutionPlanWorkflowCondition,
): string {
  return sha256(canonicalJson(condition));
}

export function executionPlanWorkflowConditionSchema(
  inputSchema: WorkflowValueSchema,
  condition: ExecutionPlanWorkflowCondition,
  label: string,
): WorkflowValueSchema {
  let schema = inputSchema;
  for (const segment of condition.path) {
    if (typeof segment === "number") {
      if (schema.type !== "array") {
        throw new Error(`${label} path does not match the input schema`);
      }
      schema = schema.items;
      continue;
    }
    if (schema.type !== "object" || !schema.properties[segment]) {
      throw new Error(`${label} path does not match the input schema`);
    }
    schema = schema.properties[segment];
  }
  return schema;
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}
