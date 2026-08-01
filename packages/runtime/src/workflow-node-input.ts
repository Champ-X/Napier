import type { ExecutionPlanWorkflowNode, JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import {
  assertWorkflowValue,
  buildExecutionPlanWorkflowNodeInput,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  workflowNodeBindingContextSha256,
} from "./workflow-schemas.js";

export function buildWorkflowExecutionNodeInput(
  context: WorkflowExecutionContext,
  node: ExecutionPlanWorkflowNode,
): JsonValue {
  const override = workflowNodeInputOverride(context, node.id);
  if (!override) {
    return buildExecutionPlanWorkflowNodeInput(
      node,
      context.input,
      context.outputs,
    );
  }
  assertWorkflowValue(
    node.inputSchema,
    override.input,
    `Workflow replacement input ${node.id}`,
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  );
  const input = structuredClone(override.input);
  const encoded = canonicalJson(input);
  if (
    sha256(encoded) !== override.inputSha256 ||
    Buffer.byteLength(encoded, "utf8") !== override.inputBytes
  ) {
    throw new Error("Workflow replacement input receipt mismatch");
  }
  return input;
}

export function workflowExecutionNodeBindingContextSha256(
  context: WorkflowExecutionContext,
  node: ExecutionPlanWorkflowNode,
): string {
  const override = workflowNodeInputOverride(context, node.id);
  return workflowNodeBindingContextSha256(
    node,
    context.input,
    context.outputs,
    override?.input,
  );
}

function workflowNodeInputOverride(
  context: WorkflowExecutionContext,
  nodeId: string,
) {
  const matches = context.inputOverrides.filter(
    (override) => override.nodeId === nodeId,
  );
  if (matches.length > 1) {
    throw new Error("Workflow replacement input is ambiguous");
  }
  return matches[0];
}
