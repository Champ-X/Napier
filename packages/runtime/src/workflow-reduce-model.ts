import type {
  ExecutionPlanWorkflowReduceNode,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { resolveExecutionPlanWorkflowValuePath } from "./workflow-schemas.js";

export const MAX_EXECUTION_PLAN_WORKFLOW_REDUCE_ITEMS = 256;

export interface WorkflowReduceProjection {
  items: JsonValue[];
  values: JsonValue[];
}

export class WorkflowReduceComputationError extends Error {
  constructor(
    readonly code:
      | "items_invalid"
      | "value_invalid"
      | "empty_extrema"
      | "arithmetic_overflow",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowReduceComputationError";
  }
}

export function workflowReduceProjection(
  node: ExecutionPlanWorkflowReduceNode,
  input: JsonValue,
): WorkflowReduceProjection {
  const selected = resolveExecutionPlanWorkflowValuePath(
    input,
    node.itemsPath,
    `${node.id}.items`,
  );
  if (
    !Array.isArray(selected) ||
    selected.length > MAX_EXECUTION_PLAN_WORKFLOW_REDUCE_ITEMS
  ) {
    throw new WorkflowReduceComputationError(
      "items_invalid",
      "Workflow Reduce items are invalid",
    );
  }
  const items = selected.map((item) => structuredClone(item));
  const values =
    node.operation === "count"
      ? items.map((item) => structuredClone(item))
      : items.map((item, index) => {
          try {
            return resolveExecutionPlanWorkflowValuePath(
              item,
              node.valuePath,
              `${node.id}.items[${String(index)}].value`,
            );
          } catch {
            throw new WorkflowReduceComputationError(
              "value_invalid",
              "Workflow Reduce value path is unavailable",
            );
          }
        });
  return { items, values };
}

export function executeWorkflowReduce(
  node: ExecutionPlanWorkflowReduceNode,
  projection: WorkflowReduceProjection,
): JsonValue {
  if (node.operation === "count") return projection.items.length;
  if (node.operation === "all" || node.operation === "any") {
    const values = projection.values.map(booleanValue);
    return node.operation === "all"
      ? values.every(Boolean)
      : values.some(Boolean);
  }
  const values = projection.values.map(numberValue);
  if (
    (node.operation === "minimum" || node.operation === "maximum") &&
    values.length === 0
  ) {
    throw new WorkflowReduceComputationError(
      "empty_extrema",
      "Workflow Reduce extrema require at least one item",
    );
  }
  if (node.operation === "minimum") {
    return normalizeJsonNumber(Math.min(...values));
  }
  if (node.operation === "maximum") {
    return normalizeJsonNumber(Math.max(...values));
  }

  let total = 0;
  for (const value of values) {
    total += value;
    if (
      !Number.isFinite(total) ||
      (node.outputSchema.type === "integer" && !Number.isSafeInteger(total))
    ) {
      throw new WorkflowReduceComputationError(
        "arithmetic_overflow",
        "Workflow Reduce sum exceeds finite safe arithmetic",
      );
    }
  }
  return total;
}

export function workflowReduceConfigurationSha256(
  node: ExecutionPlanWorkflowReduceNode,
): string {
  return sha256(
    canonicalJson({
      operation: node.operation,
      itemsPath: node.itemsPath,
      valuePath: node.valuePath ?? null,
    }),
  );
}

export function workflowReduceItemSetSha256(
  projection: WorkflowReduceProjection,
): string {
  return sha256(canonicalJson(projection.items));
}

export function workflowReduceValueSetSha256(
  projection: WorkflowReduceProjection,
): string {
  return sha256(canonicalJson(projection.values));
}

function booleanValue(value: JsonValue): boolean {
  if (typeof value !== "boolean") {
    throw new WorkflowReduceComputationError(
      "value_invalid",
      "Workflow Reduce Boolean value is invalid",
    );
  }
  return value;
}

function numberValue(value: JsonValue): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkflowReduceComputationError(
      "value_invalid",
      "Workflow Reduce numeric value is invalid",
    );
  }
  return value;
}

function normalizeJsonNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
