import {
  EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS,
  type ExecutionPlanWorkflowReduceOperation,
  type ExecutionPlanWorkflowValuePathSegment,
  type WorkflowObjectSchema,
  type WorkflowValueSchema,
} from "@napier/contracts";

import { MAX_EXECUTION_PLAN_WORKFLOW_REDUCE_ITEMS } from "./workflow-reduce-model.js";
import {
  resolveExecutionPlanWorkflowSchemaPath,
  validateExecutionPlanWorkflowValuePath,
} from "./workflow-schemas.js";

const WORKFLOW_REDUCE_OPERATIONS = new Set<string>(
  EXECUTION_PLAN_WORKFLOW_REDUCE_OPERATIONS,
);

export interface ValidatedWorkflowReduceContract {
  itemsPath: ExecutionPlanWorkflowValuePathSegment[];
  valuePath?: ExecutionPlanWorkflowValuePathSegment[];
  operation: ExecutionPlanWorkflowReduceOperation;
}

export function validateWorkflowReduceContract(
  node: Record<string, unknown>,
  inputSchema: WorkflowObjectSchema,
  outputSchema: WorkflowValueSchema,
  label: string,
): ValidatedWorkflowReduceContract {
  const itemsPath = validateExecutionPlanWorkflowValuePath(
    node["itemsPath"],
    `${label} items`,
  );
  if (!itemsPath) {
    throw new Error(`${label} items path is required`);
  }
  assertSchemaPathRequired(inputSchema, itemsPath, label);
  const itemsSchema = resolveExecutionPlanWorkflowSchemaPath(
    inputSchema,
    itemsPath,
    `${label} items`,
  );
  if (
    itemsSchema.type !== "array" ||
    itemsSchema.maxItems === undefined ||
    itemsSchema.maxItems > MAX_EXECUTION_PLAN_WORKFLOW_REDUCE_ITEMS ||
    typeof node["operation"] !== "string" ||
    !WORKFLOW_REDUCE_OPERATIONS.has(node["operation"])
  ) {
    throw new Error(`${label} Reduce contract is invalid`);
  }
  const operation = node["operation"] as ExecutionPlanWorkflowReduceOperation;
  const valuePath =
    node["valuePath"] === undefined
      ? undefined
      : validateExecutionPlanWorkflowValuePath(
          node["valuePath"],
          `${label} value`,
        );
  if (operation === "count" && valuePath !== undefined) {
    throw new Error(`${label} count Reduce cannot select a value path`);
  }
  if (valuePath) {
    assertSchemaPathRequired(itemsSchema.items, valuePath, label);
  }
  const valueSchema = resolveExecutionPlanWorkflowSchemaPath(
    itemsSchema.items,
    valuePath,
    `${label} value`,
  );
  if (operation === "count") {
    if (
      outputSchema.type !== "integer" ||
      (outputSchema.minimum !== undefined &&
        outputSchema.minimum > (itemsSchema.minItems ?? 0)) ||
      (outputSchema.maximum !== undefined &&
        outputSchema.maximum < itemsSchema.maxItems)
    ) {
      throw new Error(`${label} count Reduce output Schema is invalid`);
    }
  } else if (operation === "all" || operation === "any") {
    if (valueSchema.type !== "boolean" || outputSchema.type !== "boolean") {
      throw new Error(`${label} Boolean Reduce Schema is invalid`);
    }
  } else if (
    (valueSchema.type !== "number" && valueSchema.type !== "integer") ||
    outputSchema.type !== valueSchema.type ||
    ((operation === "minimum" || operation === "maximum") &&
      (itemsSchema.minItems ?? 0) < 1)
  ) {
    throw new Error(`${label} numeric Reduce Schema is invalid`);
  }
  return {
    itemsPath,
    ...(valuePath ? { valuePath } : {}),
    operation,
  };
}

function assertSchemaPathRequired(
  inputSchema: WorkflowValueSchema,
  path: ExecutionPlanWorkflowValuePathSegment[],
  label: string,
): void {
  let schema = inputSchema;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (schema.type !== "array" || (schema.minItems ?? 0) <= segment) {
        throw new Error(`${label} path is not always available`);
      }
      schema = schema.items;
      continue;
    }
    if (
      schema.type !== "object" ||
      !schema.required.includes(segment) ||
      !Object.hasOwn(schema.properties, segment)
    ) {
      throw new Error(`${label} path is not always available`);
    }
    schema = schema.properties[segment]!;
  }
}
