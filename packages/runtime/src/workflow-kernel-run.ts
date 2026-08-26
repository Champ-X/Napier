import { emptyUsage, type JsonValue, type RunRecord } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import { assessToolCall } from "./policy.js";
import type { LocalStore } from "./store.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteWorkflowKernelRunOptions {
  threadId: string;
  planId: string;
  agentId: string;
  agentRevision: number;
  nodeId: string;
  nodeType: "javascript" | "python";
  language: "JavaScript" | "Python";
  toolName: "javascript_kernel" | "python_kernel";
  modelId: "napier/workflow-javascript" | "napier/workflow-python";
  fallbackErrorCode: "javascript_failed" | "python_failed";
  input: JsonValue;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
  executeSession(input: { run: RunRecord; signal: AbortSignal }): Promise<{
    output: JsonValue;
    completionEventType:
      | "workflow.javascript.completed"
      | "workflow.python.completed";
    completionPayload: Record<string, JsonValue>;
  }>;
  cleanupRun(runId: string): Promise<void>;
}

export interface WorkflowKernelRunOutcome {
  run: RunRecord;
  output: JsonValue;
}

export class ExecutionPlanWorkflowKernelError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowKernelError";
  }
}

export class ExecutionPlanWorkflowKernelRun {
  private readonly workerId: string;

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    workerPrefix: "workflowjs" | "workflowpy",
  ) {
    this.workerId = createProcessLeaseOwnerId(workerPrefix);
  }

  async execute(
    options: ExecuteWorkflowKernelRunOptions,
  ): Promise<WorkflowKernelRunOutcome> {
    options.signal.throwIfAborted();
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
    let completionRecorded = false;
    let leaseLost = false;
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    options.signal.addEventListener("abort", forwardAbort, { once: true });
    if (options.signal.aborted) controller.abort();
    const heartbeat = setInterval(() => {
      void this.store
        .renewRunLease(leased.run.id, leased.token, RUN_LEASE_TTL_MS)
        .catch(() => {
          leaseLost = true;
          controller.abort();
        });
    }, RUN_LEASE_HEARTBEAT_MS);
    try {
      controller.signal.throwIfAborted();
      await options.onRunCreated(leased.run);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.started",
          category: "lifecycle",
          visibility: "debug",
          payload: {
            agentId: options.agentId,
            agentRevision: options.agentRevision,
            model: `${profile.model.provider}/${profile.model.id}`,
            source: "workflow",
            workflowNodeType: options.nodeType,
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      if (!profile.enabledTools.includes(options.toolName)) {
        throw new ExecutionPlanWorkflowKernelError(
          "tool_unavailable",
          `Workflow ${options.language} Kernel is not enabled`,
          leased.run,
        );
      }
      const decision = assessToolCall(
        profile.toolPolicy,
        options.toolName,
        { action: "start" },
        this.store.workspaceRoot,
      );
      if (!decision.allowed) {
        throw new ExecutionPlanWorkflowKernelError(
          "policy_denied",
          `Workflow ${options.language} Kernel policy denied execution`,
          leased.run,
        );
      }
      const session = await options.executeSession({
        run: leased.run,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const serializedOutput = canonicalJson(session.output);
      const outputSha256 = sha256(serializedOutput);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "message.assistant",
          category: "message",
          visibility: "hidden",
          payload: {
            role: "assistant",
            text: serializedOutput,
            model: options.modelId,
            usage: emptyUsage(),
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: session.completionEventType,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.nodeId,
            ...session.completionPayload,
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
          },
        },
        options.onEvent,
      );
      completionRecorded = true;
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      settled = true;
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: leased.run.id,
          type: "run.completed",
          category: "lifecycle",
          visibility: "debug",
          payload: { status: "completed" },
        },
        options.onEvent,
      );
      return { run, output: session.output };
    } catch (caught) {
      let error = caught;
      try {
        await options.cleanupRun(leased.run.id);
      } catch {
        error = new ExecutionPlanWorkflowKernelError(
          "cleanup_failed",
          `Workflow ${options.language} Kernel cleanup failed`,
          leased.run,
        );
      }
      if (settled) throw error;
      if (completionRecorded) {
        let interrupted = false;
        try {
          await this.store.finishRun(leased.run.id, "interrupted", {
            error: `Workflow ${options.language} settlement interrupted`,
            leaseToken: leased.token,
          });
          interrupted = true;
        } catch {
          // Lease expiry remains the fallback when Store settlement is down.
        }
        if (interrupted) {
          await this.ledger
            .append(
              {
                threadId: options.threadId,
                runId: leased.run.id,
                type: "run.interrupted",
                category: "lifecycle",
                visibility: "user",
                payload: {
                  status: "interrupted",
                  errorCode: "settlement_interrupted",
                  diagnosticSha256: sha256(
                    `Workflow ${options.language} settlement interrupted`,
                  ),
                },
              },
              options.onEvent,
            )
            .catch(() => undefined);
        }
        throw new ExecutionPlanWorkflowKernelError(
          "settlement_interrupted",
          `Workflow ${options.language} Run settlement was interrupted`,
          leased.run,
        );
      }
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowKernelError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : options.fallbackErrorCode;
      const diagnosticSha256 = sha256(errorMessage(error));
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
              diagnosticSha256,
            },
          },
          options.onEvent,
        )
        .catch(() => undefined);
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow ${options.language} ${code}`,
          leaseToken: leased.token,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowKernelError) throw error;
      throw new ExecutionPlanWorkflowKernelError(
        code,
        `Workflow ${options.language} execution failed`,
        leased.run,
      );
    } finally {
      clearInterval(heartbeat);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
