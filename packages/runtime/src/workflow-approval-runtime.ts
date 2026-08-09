import type {
  ExecutionPlanWorkflowApprovalNode,
  OperatorDecision,
  RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore, OperatorDecisionMutation } from "./store.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_APPROVAL_REQUESTED_EVENT,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface RequestWorkflowApprovalOptions {
  threadId: string;
  planId: string;
  manifestSha256: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowApprovalNode;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ContinueWorkflowApprovalOptions {
  threadId: string;
  planId: string;
  agentId: string;
  agentRevision: number;
  originRun: RunRecord;
  decision: OperatorDecision;
  onEvent?: EventSink;
}

export interface WorkflowApprovalRequestOutcome {
  run: RunRecord;
  decision: OperatorDecision;
  expiresAt: string;
}

export class WorkflowApprovalRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "WorkflowApprovalRuntimeError";
  }
}

export class ExecutionPlanWorkflowApprovalRuntime {
  private readonly workerId = createProcessLeaseOwnerId("workflowapproval");

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async request(
    options: RequestWorkflowApprovalOptions,
  ): Promise<WorkflowApprovalRequestOutcome> {
    const profile = this.store.getAgentRevision(
      options.agentId,
      options.agentRevision,
    ).profile;
    const leased = await this.store.createLeasedRun(
      {
        threadId: options.threadId,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model: profile.model,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
      },
      {
        ownerId: this.workerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    let settled = false;
    let leaseLost = false;
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    options.signal.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal.aborted) controller.abort();
    const heartbeat = this.heartbeat(
      leased.run.id,
      leased.token,
      controller,
      () => {
        leaseLost = true;
      },
    );
    try {
      controller.signal.throwIfAborted();
      await options.onRunCreated(leased.run);
      await this.appendRunStarted(
        options.threadId,
        options.agentId,
        options.agentRevision,
        leased.run,
        profile.model,
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      const mutation = await this.store.requestOperatorDecision({
        threadId: options.threadId,
        runId: leased.run.id,
        header: options.node.header,
        question: options.node.question,
        options: [options.node.approve, options.node.reject],
        multiSelect: false,
      });
      await emitOperatorDecisionMutation(mutation, options.onEvent);
      const requested = mutation.events.find(
        (event) => event.type === "operator.decision.requested",
      );
      const requestSha256 = record(requested?.payload)?.["requestSha256"];
      if (
        !requested ||
        typeof requestSha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(requestSha256)
      ) {
        throw new Error("Workflow approval decision receipt is invalid");
      }
      const expiresAt = new Date(
        Date.parse(mutation.decision.requestedAt) + options.node.timeoutMs,
      ).toISOString();
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: WORKFLOW_APPROVAL_REQUESTED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            ...workflowNodeEventMetadata(options.node),
            attempt: options.attempt,
            manifestSha256: options.manifestSha256,
            inputSha256: options.inputSha256,
            inputSchemaSha256: workflowSchemaSha256(options.node.inputSchema),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
            decisionId: mutation.decision.id,
            requestedEventSeq: mutation.decision.requestedEventSeq,
            decisionRequestSha256: requestSha256,
            expiresAt,
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.waiting_for_operator",
          category: "lifecycle",
          visibility: "user",
          payload: {
            status: "waiting",
            operatorDecisionId: mutation.decision.id,
            workflowPlanId: options.planId,
            workflowNodeId: options.node.id,
          },
        },
        options.onEvent,
      );
      await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
        waitForOperatorDecisionId: mutation.decision.id,
      });
      settled = true;
      if (controller.signal.aborted) {
        const cancelled = await this.store.cancelOperatorDecision(
          options.threadId,
          mutation.decision.id,
        );
        await emitOperatorDecisionMutation(cancelled, options.onEvent);
        throw new WorkflowApprovalRuntimeError(
          leaseLost ? "lease_lost" : "cancelled",
          leaseLost
            ? "Workflow approval request lost its Run lease"
            : "Workflow approval request was cancelled",
          leased.run,
        );
      }
      return {
        run: leased.run,
        decision: mutation.decision,
        expiresAt,
      };
    } catch (error) {
      const cancelled = options.signal.aborted;
      const code =
        error instanceof WorkflowApprovalRuntimeError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : cancelled
              ? "cancelled"
              : "approval_request_failed";
      if (!settled) {
        await this.ledger
          .append(
            {
              threadId: options.threadId,
              runId: leased.run.id,
              type: cancelled ? "run.cancelled" : "run.failed",
              category: "lifecycle",
              visibility: "user",
              payload: {
                status: cancelled ? "cancelled" : "failed",
                errorCode: code,
                diagnosticSha256: sha256(errorMessage(error)),
              },
            },
            options.onEvent,
          )
          .catch(() => undefined);
        await this.store
          .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
            error: `Workflow approval ${code}`,
            leaseToken: leased.token,
          })
          .catch(() => undefined);
      }
      if (error instanceof WorkflowApprovalRuntimeError) throw error;
      throw new WorkflowApprovalRuntimeError(
        code,
        "Workflow approval request failed",
        leased.run,
      );
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }

  async continue(
    options: ContinueWorkflowApprovalOptions,
  ): Promise<OperatorDecision> {
    const profile = this.store.getAgentRevision(
      options.agentId,
      options.agentRevision,
    ).profile;
    const leased = await this.store.createLeasedRun(
      {
        threadId: options.threadId,
        agentId: options.agentId,
        agentRevision: options.agentRevision,
        model: profile.model,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
        parentRunId: options.originRun.id,
        operatorDecisionId: options.decision.id,
      },
      {
        ownerId: this.workerId,
        ttlMs: RUN_LEASE_TTL_MS,
      },
    );
    let settled = false;
    try {
      await this.appendRunStarted(
        options.threadId,
        options.agentId,
        options.agentRevision,
        leased.run,
        profile.model,
        options.onEvent,
      );
      const mutation = await this.store.continueOperatorDecision(
        options.threadId,
        options.decision.id,
        leased.run.id,
      );
      await emitOperatorDecisionMutation(mutation, options.onEvent);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.completed",
          category: "lifecycle",
          visibility: "debug",
          payload: {
            status: "completed",
            parentRunId: options.originRun.id,
            workflowApprovalDecisionId: options.decision.id,
          },
        },
        options.onEvent,
      );
      await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      settled = true;
      return mutation.decision;
    } finally {
      if (!settled) {
        await this.store
          .finishRun(leased.run.id, "failed", {
            error: "Workflow approval continuation failed",
            leaseToken: leased.token,
          })
          .catch(() => undefined);
      }
    }
  }

  private async appendRunStarted(
    threadId: string,
    agentId: string,
    agentRevision: number,
    run: RunRecord,
    model: { provider: string; id: string },
    onEvent?: EventSink,
  ): Promise<void> {
    await this.ledger.append(
      {
        threadId,
        runId: run.id,
        type: "run.started",
        category: "lifecycle",
        visibility: "debug",
        payload: {
          agentId,
          agentRevision,
          model: `${model.provider}/${model.id}`,
          source: "workflow",
          workflowNodeType: "approval",
          configurationSha256: run.configuration?.contentSha256 ?? "",
        },
      },
      onEvent,
    );
  }

  private heartbeat(
    runId: string,
    leaseToken: string,
    controller: AbortController,
    onLost: () => void,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      void this.store
        .renewRunLease(runId, leaseToken, RUN_LEASE_TTL_MS)
        .catch(() => {
          onLost();
          controller.abort();
        });
    }, RUN_LEASE_HEARTBEAT_MS);
  }
}

export async function emitOperatorDecisionMutation(
  mutation: OperatorDecisionMutation,
  sink?: EventSink,
): Promise<void> {
  if (!sink) return;
  for (const event of mutation.events) {
    try {
      await sink(event);
    } catch {
      // The decision is already durable; a disconnected stream cannot erase it.
    }
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
