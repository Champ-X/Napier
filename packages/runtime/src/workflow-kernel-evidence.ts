import type {
  ExecutionPlanWorkflowJavascriptNode,
  ExecutionPlanWorkflowPythonNode,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import {
  hasWorkflowJavascriptCompletionEvent,
  readWorkflowJavascriptOutputEvidence,
} from "./workflow-javascript-evidence.js";
import {
  hasWorkflowPythonCompletionEvent,
  readWorkflowPythonOutputEvidence,
} from "./workflow-python-evidence.js";

export type ExecutionPlanWorkflowKernelNode =
  | ExecutionPlanWorkflowJavascriptNode
  | ExecutionPlanWorkflowPythonNode;

export function hasWorkflowKernelCompletionEvent(
  events: RunEvent[],
  node: ExecutionPlanWorkflowKernelNode,
  planId: string,
  runId: string,
): boolean {
  return node.type === "javascript"
    ? hasWorkflowJavascriptCompletionEvent(events, planId, node.id, runId)
    : hasWorkflowPythonCompletionEvent(events, planId, node.id, runId);
}

export function readWorkflowKernelOutputEvidence(options: {
  events: RunEvent[];
  node: ExecutionPlanWorkflowKernelNode;
  runId: string;
  planId: string;
  manifestSha256: string;
  inputSha256: string;
  attempt: number;
  assistantOutput: string;
}): JsonValue {
  return options.node.type === "javascript"
    ? readWorkflowJavascriptOutputEvidence({
        ...options,
        node: options.node,
      })
    : readWorkflowPythonOutputEvidence({
        ...options,
        node: options.node,
      });
}
