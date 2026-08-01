import type {
  ExecutionPlanWorkflowBreakpoint,
  ExecutionPlanWorkflowResult,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_BLOCKED_EVENT,
  WORKFLOW_CANCELLED_EVENT,
  WORKFLOW_COMPLETED_EVENT,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_PAUSED_EVENT,
  WORKFLOW_WAITING_EVENT,
} from "./workflow-ledger.js";
import { assertWorkflowValue } from "./workflow-schemas.js";

export async function finishExecutionPlanWorkflow(
  store: LocalStore,
  ledger: ExecutionPlanWorkflowLedger,
  context: WorkflowExecutionContext,
  status: ExecutionPlanWorkflowResult["status"],
  breakpoint?: ExecutionPlanWorkflowBreakpoint,
): Promise<ExecutionPlanWorkflowResult> {
  context.plan = store.getPlan(context.plan.id);
  const output =
    status === "completed"
      ? context.outputs.get(context.manifest.outputNodeId)
      : undefined;
  if (status === "completed") {
    if (output === undefined) {
      throw new Error("Workflow output node result is unavailable");
    }
    assertWorkflowValue(
      context.manifest.outputSchema,
      output,
      "Workflow output",
    );
  }
  if (
    (status === "paused" && !breakpoint) ||
    (status !== "paused" && breakpoint)
  ) {
    throw new Error("Workflow breakpoint result state is invalid");
  }
  const nodeResults = context.manifest.nodes.flatMap((node) => {
    const result = context.nodeResults.get(node.id);
    return result ? [structuredClone(result)] : [];
  });
  const base = {
    kind: "napier.execution-plan-workflow-result" as const,
    schemaVersion: 1 as const,
    threadId: context.threadId,
    planId: context.plan.id,
    manifestSha256: context.manifest.contentSha256,
    blueprintSha256: context.manifest.blueprint.contentSha256,
    status,
    resumed: context.resumed,
    nodeResults,
    ...(breakpoint ? { breakpoint: structuredClone(breakpoint) } : {}),
    ...(output !== undefined ? { output: structuredClone(output) } : {}),
    ...(output !== undefined
      ? { outputSha256: sha256(canonicalJson(output)) }
      : {}),
  };
  const result: ExecutionPlanWorkflowResult = {
    ...base,
    resultSha256: sha256(canonicalJson(base)),
  };
  const eventType = workflowTerminalEventType(status);
  const completedNodeCount = nodeResults.filter(
    (node) => node.status === "completed",
  ).length;
  const skippedNodeCount = nodeResults.filter(
    (node) => node.status === "skipped",
  ).length;
  if (
    !(await ledger.hasTerminalEvent({
      threadId: context.threadId,
      planId: context.plan.id,
      eventType,
      manifestSha256: context.manifest.contentSha256,
      blueprintSha256: context.manifest.blueprint.contentSha256,
      status,
      planRevision: context.plan.revision,
      nodeResultCount: nodeResults.length,
      completedNodeCount,
      skippedNodeCount,
      ...(breakpoint ? { breakpoint } : {}),
      ...(result.outputSha256 ? { outputSha256: result.outputSha256 } : {}),
    }))
  ) {
    await ledger.append(
      {
        threadId: context.threadId,
        runId: createId("runctl"),
        type: eventType,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          manifestSha256: context.manifest.contentSha256,
          blueprintSha256: context.manifest.blueprint.contentSha256,
          status,
          planRevision: context.plan.revision,
          nodeResultCount: nodeResults.length,
          completedNodeCount,
          skippedNodeCount,
          ...(breakpoint
            ? {
                breakpointNodeId: breakpoint.nodeId,
                breakpointIndex: breakpoint.breakpointIndex,
                breakpointCount: breakpoint.breakpointCount,
                breakpointReachedEventSeq: breakpoint.reachedEventSeq,
                breakpointBindingContextSha256: breakpoint.bindingContextSha256,
              }
            : {}),
          ...(result.outputSha256 ? { outputSha256: result.outputSha256 } : {}),
          resultSha256: result.resultSha256,
        },
      },
      context.onEvent,
    );
  }
  await store.setThreadStatus(
    context.threadId,
    status === "waiting" || status === "paused"
      ? "waiting"
      : status === "blocked"
        ? "failed"
        : "idle",
  );
  return result;
}

function workflowTerminalEventType(
  status: ExecutionPlanWorkflowResult["status"],
): string {
  if (status === "completed") return WORKFLOW_COMPLETED_EVENT;
  if (status === "waiting") return WORKFLOW_WAITING_EVENT;
  if (status === "paused") return WORKFLOW_PAUSED_EVENT;
  if (status === "cancelled") return WORKFLOW_CANCELLED_EVENT;
  return WORKFLOW_BLOCKED_EVENT;
}
