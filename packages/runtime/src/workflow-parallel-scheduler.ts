import type { ExecutionPlanWorkflowNode } from "@napier/contracts";

import type { WorkflowExecutionContext } from "./workflow-context.js";

export const DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY = 1;

export interface WorkflowBatchNodeOutcome<T> {
  node: ExecutionPlanWorkflowNode;
  outcome: T;
}

export async function executeExecutionPlanWorkflowReadyBatch<T>(
  context: WorkflowExecutionContext,
  executeNode: (
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
  ) => Promise<T>,
  releasedNodeId?: string,
): Promise<WorkflowBatchNodeOutcome<T>[]> {
  const nodes = selectExecutionPlanWorkflowReadyBatch(context, releasedNodeId);
  if (nodes.length === 0) return [];

  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  context.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (context.signal?.aborted) controller.abort();
  try {
    const tasks = nodes.map(async (node) => {
      try {
        return await executeNode(
          forkWorkflowExecutionContext(context, controller.signal),
          node,
        );
      } catch (error) {
        controller.abort();
        throw error;
      }
    });
    const settled = await Promise.allSettled(tasks);
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejected) throw rejected.reason;
    return nodes.map((node, index) => ({
      node,
      outcome: (settled[index] as PromiseFulfilledResult<T>).value,
    }));
  } finally {
    context.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function executionPlanWorkflowMaxConcurrency(
  context: Pick<WorkflowExecutionContext, "manifest">,
): number {
  return (
    context.manifest.maxConcurrency ??
    DEFAULT_EXECUTION_PLAN_WORKFLOW_CONCURRENCY
  );
}

function selectExecutionPlanWorkflowReadyBatch(
  context: WorkflowExecutionContext,
  releasedNodeId?: string,
): ExecutionPlanWorkflowNode[] {
  const ready = context.manifest.nodes.filter(
    (node) =>
      context.plan.steps.find((step) => step.id === node.id)?.status ===
      "ready",
  );
  if (releasedNodeId) {
    const released = ready.find((node) => node.id === releasedNodeId);
    if (!released) {
      throw new Error("Workflow released breakpoint node is not ready");
    }
    return [released];
  }
  if (ready.length === 0) return [];
  const maxConcurrency = executionPlanWorkflowMaxConcurrency(context);
  if (maxConcurrency === 1) return ready.slice(0, 1);

  const mapNode = ready.find((node) => node.type === "map");
  if (mapNode) return [mapNode];
  const executable = ready.filter((node) => node.type !== "approval");
  if (executable.length > 0) return executable.slice(0, maxConcurrency);
  return ready.slice(0, 1);
}

function forkWorkflowExecutionContext(
  context: WorkflowExecutionContext,
  signal: AbortSignal,
): WorkflowExecutionContext {
  return {
    threadId: context.threadId,
    manifest: context.manifest,
    input: context.input,
    agentId: context.agentId,
    agentRevision: context.agentRevision,
    plan: structuredClone(context.plan),
    resumed: context.resumed,
    retryBlocked: context.retryBlocked,
    breakBeforeNodeIds: [...context.breakBeforeNodeIds],
    continueBreakpoint: context.continueBreakpoint,
    signal,
    ...(context.onEvent ? { onEvent: context.onEvent } : {}),
    outputs: new Map(
      [...context.outputs].map(([nodeId, output]) => [
        nodeId,
        structuredClone(output),
      ]),
    ),
    nodeResults: new Map(
      [...context.nodeResults].map(([nodeId, result]) => [
        nodeId,
        structuredClone(result),
      ]),
    ),
    reusedNodes: context.reusedNodes.map((node) => structuredClone(node)),
    simulatedNodes: context.simulatedNodes.map((node) => structuredClone(node)),
    inputOverrides: context.inputOverrides.map((override) =>
      structuredClone(override),
    ),
  };
}
