import type {
  ExecutionPlan,
  ExecutionPlanWorkflowAgentNode,
  ExecutionPlanWorkflowManifest,
  JsonValue,
  RunEvent,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import { workflowPlanStepPayload } from "./workflow-runtime-model.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";

export const WORKFLOW_EVENT_SCHEMA_VERSION = 1;
export const WORKFLOW_STARTED_EVENT = "workflow.started";
export const WORKFLOW_NODE_STARTED_EVENT = "workflow.node.started";
export const WORKFLOW_NODE_COMPLETED_EVENT = "workflow.node.completed";
export const WORKFLOW_NODE_FAILED_EVENT = "workflow.node.failed";
export const WORKFLOW_COMPLETED_EVENT = "workflow.completed";
export const WORKFLOW_BLOCKED_EVENT = "workflow.blocked";
export const WORKFLOW_CANCELLED_EVENT = "workflow.cancelled";

export interface WorkflowLedgerContext {
  threadId: string;
  manifest: ExecutionPlanWorkflowManifest;
  plan: ExecutionPlan;
  onEvent?: EventSink;
}

export interface RecoveredWorkflowStart {
  input: JsonValue;
  agentId: string;
  agentRevision: number;
}

export class ExecutionPlanWorkflowLedger {
  constructor(private readonly store: LocalStore) {}

  async recoverWorkflowStart(
    threadId: string,
    planId: string,
    manifestSha256: string,
  ): Promise<RecoveredWorkflowStart> {
    const events = await this.store.listEvents(threadId);
    const started = events.find(
      (event) =>
        event.type === WORKFLOW_STARTED_EVENT &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === planId,
    );
    if (
      !started ||
      !isWorkflowRecord(started.payload) ||
      started.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      started.payload["manifestSha256"] !== manifestSha256 ||
      started.payload["input"] === undefined ||
      typeof started.payload["inputSha256"] !== "string" ||
      typeof started.payload["agentId"] !== "string" ||
      !/^[a-z][a-z0-9_]{2,80}$/u.test(started.payload["agentId"]) ||
      !positiveInteger(started.payload["agentRevision"])
    ) {
      throw new Error("Workflow start evidence is unavailable or mismatched");
    }
    const input = structuredClone(started.payload["input"]) as JsonValue;
    if (sha256(canonicalJson(input)) !== started.payload["inputSha256"]) {
      throw new Error("Workflow input evidence hash mismatch");
    }
    return {
      input,
      agentId: started.payload["agentId"],
      agentRevision: Number(started.payload["agentRevision"]),
    };
  }

  async nodeAssistantOutput(threadId: string, runId: string): Promise<string> {
    const events = await this.store.listEvents(threadId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (
        event.runId === runId &&
        event.type === "message.assistant" &&
        isWorkflowRecord(event.payload) &&
        typeof event.payload["text"] === "string"
      ) {
        return event.payload["text"];
      }
    }
    throw new Error("Workflow node assistant output is unavailable");
  }

  async verifyOrRecoverNodeCompletedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowAgentNode,
    runId: string,
    inputSha256: string,
    outputSha256: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    const attempt = await this.attemptForRun(
      context.threadId,
      context.plan.id,
      node.id,
      runId,
    );
    const completed = events.find(
      (event) =>
        event.type === WORKFLOW_NODE_COMPLETED_EVENT &&
        event.runId === runId &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    if (completed) {
      if (
        !isWorkflowRecord(completed.payload) ||
        completed.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
        completed.payload["manifestSha256"] !==
          context.manifest.contentSha256 ||
        completed.payload["attempt"] !== attempt ||
        completed.payload["inputSha256"] !== inputSha256 ||
        completed.payload["outputSha256"] !== outputSha256 ||
        completed.payload["inputSchemaSha256"] !==
          workflowSchemaSha256(node.inputSchema) ||
        completed.payload["outputSchemaSha256"] !==
          workflowSchemaSha256(node.outputSchema) ||
        typeof completed.payload["recovered"] !== "boolean"
      ) {
        throw new Error("Workflow node completion evidence mismatch");
      }
      return;
    }
    await this.append(
      {
        threadId: context.threadId,
        runId,
        type: WORKFLOW_NODE_COMPLETED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          attempt,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          outputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          recovered: true,
        },
      },
      context.onEvent,
    );
  }

  async ensureNodeStartedEvent(
    context: WorkflowLedgerContext,
    node: ExecutionPlanWorkflowAgentNode,
    runId: string,
    inputSha256: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    const started = events.find(
      (event) =>
        event.type === WORKFLOW_NODE_STARTED_EVENT &&
        event.runId === runId &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === context.plan.id &&
        event.payload["nodeId"] === node.id,
    );
    if (started && isWorkflowRecord(started.payload)) {
      const before = started.payload["planRevisionBefore"];
      const after = started.payload["planRevisionAfter"];
      if (
        started.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
        started.payload["manifestSha256"] !== context.manifest.contentSha256 ||
        !workflowAttempt(started.payload["attempt"]) ||
        Number(started.payload["attempt"]) > node.maxAttempts ||
        started.payload["inputSha256"] !== inputSha256 ||
        started.payload["inputSchemaSha256"] !==
          workflowSchemaSha256(node.inputSchema) ||
        started.payload["outputSchemaSha256"] !==
          workflowSchemaSha256(node.outputSchema) ||
        !positiveInteger(before) ||
        !positiveInteger(after) ||
        Number(after) < Number(before) ||
        typeof started.payload["recovered"] !== "boolean"
      ) {
        throw new Error("Workflow node start evidence mismatch");
      }
      return;
    }
    const attempt = await this.nextAttempt(
      context.threadId,
      context.plan.id,
      node.id,
    );
    await this.append(
      {
        threadId: context.threadId,
        runId,
        type: WORKFLOW_NODE_STARTED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          attempt,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          planRevisionBefore: context.plan.revision,
          planRevisionAfter: context.plan.revision,
          recovered: true,
        },
      },
      context.onEvent,
    );
  }

  async nextAttempt(
    threadId: string,
    planId: string,
    nodeId: string,
  ): Promise<number> {
    const events = await this.store.listEvents(threadId);
    const attempts = events.flatMap((event) => {
      if (
        (event.type !== WORKFLOW_NODE_STARTED_EVENT &&
          event.type !== WORKFLOW_NODE_FAILED_EVENT) ||
        !isWorkflowRecord(event.payload) ||
        event.payload["planId"] !== planId ||
        event.payload["nodeId"] !== nodeId ||
        !Number.isSafeInteger(event.payload["attempt"])
      ) {
        return [];
      }
      return [Number(event.payload["attempt"])];
    });
    return Math.max(0, ...attempts) + 1;
  }

  async attemptForRun(
    threadId: string,
    planId: string,
    nodeId: string,
    runId: string,
  ): Promise<number> {
    const event = (await this.store.listEvents(threadId)).find(
      (candidate) =>
        candidate.type === WORKFLOW_NODE_STARTED_EVENT &&
        candidate.runId === runId &&
        isWorkflowRecord(candidate.payload) &&
        candidate.payload["planId"] === planId &&
        candidate.payload["nodeId"] === nodeId,
    );
    if (
      !event ||
      !isWorkflowRecord(event.payload) ||
      !workflowAttempt(event.payload["attempt"])
    ) {
      throw new Error("Workflow node attempt evidence is unavailable");
    }
    return Number(event.payload["attempt"]);
  }

  async hasTerminalEvent(input: {
    threadId: string;
    planId: string;
    eventType: string;
    manifestSha256: string;
    blueprintSha256: string;
    status: string;
    nodeResultCount: number;
    completedNodeCount: number;
    outputSha256?: string;
  }): Promise<boolean> {
    const terminal = (await this.store.listEvents(input.threadId)).find(
      (event) =>
        event.type === input.eventType &&
        isWorkflowRecord(event.payload) &&
        event.payload["planId"] === input.planId,
    );
    if (!terminal || !isWorkflowRecord(terminal.payload)) return false;
    if (
      terminal.payload["schemaVersion"] !== WORKFLOW_EVENT_SCHEMA_VERSION ||
      terminal.payload["manifestSha256"] !== input.manifestSha256 ||
      terminal.payload["blueprintSha256"] !== input.blueprintSha256 ||
      terminal.payload["status"] !== input.status ||
      terminal.payload["nodeResultCount"] !== input.nodeResultCount ||
      terminal.payload["completedNodeCount"] !== input.completedNodeCount ||
      terminal.payload["outputSha256"] !== input.outputSha256 ||
      !hash(terminal.payload["resultSha256"])
    ) {
      throw new Error("Workflow terminal evidence mismatch");
    }
    return true;
  }

  async appendPlanStepEvent(
    context: WorkflowLedgerContext,
    plan: ExecutionPlan,
    nodeId: string,
    suffix: "started" | "completed" | "blocked" | "reopened",
    runId: string,
  ): Promise<void> {
    const step = plan.steps.find((candidate) => candidate.id === nodeId)!;
    await this.append(
      {
        threadId: context.threadId,
        runId,
        type: `plan.step.${suffix}`,
        category: "plan",
        visibility: "user",
        payload: workflowPlanStepPayload(plan, step),
      },
      context.onEvent,
    );
  }

  async ensurePlanStepEvent(
    context: WorkflowLedgerContext,
    plan: ExecutionPlan,
    nodeId: string,
    suffix: "completed" | "blocked",
    runId: string,
  ): Promise<void> {
    const events = await this.store.listEvents(context.threadId);
    if (
      events.some(
        (event) =>
          event.type === `plan.step.${suffix}` &&
          isWorkflowRecord(event.payload) &&
          event.payload["planId"] === plan.id &&
          event.payload["stepId"] === nodeId,
      )
    ) {
      return;
    }
    await this.appendPlanStepEvent(context, plan, nodeId, suffix, runId);
  }

  async append(
    input: Parameters<LocalStore["appendEvent"]>[0],
    sink?: EventSink,
  ): Promise<RunEvent> {
    const event = await this.store.appendEvent(input);
    if (sink) {
      try {
        await sink(event);
      } catch {
        // Workflow evidence must remain durable if a stream consumer disconnects.
      }
    }
    return event;
  }
}

export function isWorkflowRecord(
  value: unknown,
): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workflowAttempt(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 3
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
