import type {
  ExecutionPlanWorkflowBreakpoint,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  isWorkflowRecord,
} from "./workflow-ledger.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import { workflowExecutionNodeBindingContextSha256 } from "./workflow-node-input.js";

export const WORKFLOW_BREAKPOINT_REACHED_EVENT = "workflow.breakpoint.reached";
export const WORKFLOW_BREAKPOINT_CONTINUED_EVENT =
  "workflow.breakpoint.continued";

type BreakpointDisposition =
  | ExecutionPlanWorkflowBreakpoint
  | "cancelled"
  | undefined;

interface RecoveredBreakpoint {
  breakpoint: ExecutionPlanWorkflowBreakpoint;
  planRevision: number;
  continued: boolean;
}

export class ExecutionPlanWorkflowBreakpointRuntime {
  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async beforeReadyBatch(
    context: WorkflowExecutionContext,
  ): Promise<BreakpointDisposition> {
    if (context.signal?.aborted) return "cancelled";
    const recovered = await this.recover(context);
    if (context.signal?.aborted) return "cancelled";
    const open = [...recovered.values()].filter(
      (breakpoint) => !breakpoint.continued,
    );
    if (open.length > 1) {
      throw new Error("Workflow has multiple open breakpoints");
    }
    if (open.length === 1) {
      const current = open[0]!;
      const step = context.plan.steps.find(
        (candidate) => candidate.id === current.breakpoint.nodeId,
      );
      if (
        step?.status !== "ready" ||
        current.planRevision !== context.plan.revision
      ) {
        throw new Error("Workflow open breakpoint state has drifted");
      }
      if (!context.continueBreakpoint) return current.breakpoint;
      await this.appendContinued(context, current);
      context.continueBreakpoint = false;
      if (context.signal?.aborted) return "cancelled";
      current.continued = true;
    } else if (context.continueBreakpoint) {
      throw new Error("Workflow has no open breakpoint to continue");
    }

    for (const [index, nodeId] of context.breakBeforeNodeIds.entries()) {
      if (recovered.has(nodeId)) continue;
      const step = context.plan.steps.find(
        (candidate) => candidate.id === nodeId,
      );
      if (!step) throw new Error("Workflow breakpoint Plan step is missing");
      if (step.status === "pending") continue;
      if (step.status !== "ready") {
        throw new Error("Workflow breakpoint was bypassed without evidence");
      }
      const breakpoint = await this.appendReached(context, nodeId, index);
      return context.signal?.aborted ? "cancelled" : breakpoint;
    }
    return undefined;
  }

  private async recover(
    context: WorkflowExecutionContext,
  ): Promise<Map<string, RecoveredBreakpoint>> {
    const recovered = new Map<string, RecoveredBreakpoint>();
    const events = await this.store.listEvents(context.threadId);
    for (const event of events) {
      if (
        event.type !== WORKFLOW_BREAKPOINT_REACHED_EVENT &&
        event.type !== WORKFLOW_BREAKPOINT_CONTINUED_EVENT
      ) {
        continue;
      }
      const payload = isWorkflowRecord(event.payload)
        ? event.payload
        : undefined;
      if (payload?.["planId"] !== context.plan.id) continue;
      const shared = this.validateSharedEvent(context, event, payload);
      const current = recovered.get(shared.nodeId);
      if (event.type === WORKFLOW_BREAKPOINT_REACHED_EVENT) {
        assertExactKeys(payload, [
          "schemaVersion",
          "planId",
          "manifestSha256",
          "nodeId",
          "breakpointIndex",
          "breakpointCount",
          "bindingContextSha256",
          "planRevision",
        ]);
        if (current) {
          throw new Error("Workflow breakpoint reached evidence is duplicated");
        }
        recovered.set(shared.nodeId, {
          breakpoint: {
            nodeId: shared.nodeId,
            breakpointIndex: shared.breakpointIndex,
            breakpointCount: context.breakBeforeNodeIds.length,
            reachedEventSeq: event.seq,
            bindingContextSha256: shared.bindingContextSha256,
          },
          planRevision: shared.planRevision,
          continued: false,
        });
        continue;
      }
      assertExactKeys(payload, [
        "schemaVersion",
        "planId",
        "manifestSha256",
        "nodeId",
        "breakpointIndex",
        "breakpointCount",
        "bindingContextSha256",
        "planRevision",
        "reachedEventSeq",
      ]);
      if (
        !current ||
        current.continued ||
        payload["reachedEventSeq"] !== current.breakpoint.reachedEventSeq ||
        event.seq <= current.breakpoint.reachedEventSeq ||
        shared.planRevision !== current.planRevision
      ) {
        throw new Error("Workflow breakpoint continuation evidence is invalid");
      }
      current.continued = true;
    }
    return recovered;
  }

  private validateSharedEvent(
    context: WorkflowExecutionContext,
    event: RunEvent,
    payload: Record<string, JsonValue>,
  ): {
    nodeId: string;
    breakpointIndex: number;
    bindingContextSha256: string;
    planRevision: number;
  } {
    const nodeId = payload["nodeId"];
    const breakpointIndex = payload["breakpointIndex"];
    const configuredIndex =
      typeof nodeId === "string"
        ? context.breakBeforeNodeIds.indexOf(nodeId)
        : -1;
    const node = context.manifest.nodes.find(
      (candidate) => candidate.id === nodeId,
    );
    const expectedBindingSha256 = node
      ? workflowExecutionNodeBindingContextSha256(context, node)
      : undefined;
    if (
      event.category !== "plan" ||
      event.visibility !== "user" ||
      payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      payload["manifestSha256"] !== context.manifest.contentSha256 ||
      configuredIndex < 0 ||
      breakpointIndex !== configuredIndex ||
      payload["breakpointCount"] !== context.breakBeforeNodeIds.length ||
      typeof payload["bindingContextSha256"] !== "string" ||
      payload["bindingContextSha256"] !== expectedBindingSha256 ||
      !Number.isSafeInteger(payload["planRevision"]) ||
      Number(payload["planRevision"]) < 1
    ) {
      throw new Error("Workflow breakpoint evidence is mismatched");
    }
    return {
      nodeId: nodeId as string,
      breakpointIndex: Number(breakpointIndex),
      bindingContextSha256: payload["bindingContextSha256"],
      planRevision: Number(payload["planRevision"]),
    };
  }

  private async appendReached(
    context: WorkflowExecutionContext,
    nodeId: string,
    breakpointIndex: number,
  ): Promise<ExecutionPlanWorkflowBreakpoint> {
    const node = context.manifest.nodes.find(
      (candidate) => candidate.id === nodeId,
    )!;
    const bindingContextSha256 = workflowExecutionNodeBindingContextSha256(
      context,
      node,
    );
    const event = await this.ledger.append(
      {
        threadId: context.threadId,
        runId: createId("runctl"),
        type: WORKFLOW_BREAKPOINT_REACHED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          manifestSha256: context.manifest.contentSha256,
          nodeId,
          breakpointIndex,
          breakpointCount: context.breakBeforeNodeIds.length,
          bindingContextSha256,
          planRevision: context.plan.revision,
        },
      },
      context.onEvent,
    );
    return {
      nodeId,
      breakpointIndex,
      breakpointCount: context.breakBeforeNodeIds.length,
      reachedEventSeq: event.seq,
      bindingContextSha256,
    };
  }

  private async appendContinued(
    context: WorkflowExecutionContext,
    recovered: RecoveredBreakpoint,
  ): Promise<void> {
    const breakpoint = recovered.breakpoint;
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId: createId("runctl"),
        type: WORKFLOW_BREAKPOINT_CONTINUED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          manifestSha256: context.manifest.contentSha256,
          nodeId: breakpoint.nodeId,
          breakpointIndex: breakpoint.breakpointIndex,
          breakpointCount: breakpoint.breakpointCount,
          bindingContextSha256: breakpoint.bindingContextSha256,
          planRevision: recovered.planRevision,
          reachedEventSeq: breakpoint.reachedEventSeq,
        },
      },
      context.onEvent,
    );
  }
}

function assertExactKeys(
  payload: Record<string, JsonValue>,
  keys: string[],
): void {
  const expected = new Set(keys);
  if (
    Object.keys(payload).length !== expected.size ||
    Object.keys(payload).some((key) => !expected.has(key))
  ) {
    throw new Error("Workflow breakpoint evidence fields are invalid");
  }
}
