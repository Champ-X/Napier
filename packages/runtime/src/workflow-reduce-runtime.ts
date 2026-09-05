import {
  emptyUsage,
  type ExecutionPlanWorkflowReduceNode,
  type JsonValue,
  type RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore } from "./store.js";
import { WORKFLOW_REDUCE_COMPLETED_EVENT } from "./workflow-reduce-evidence.js";
import {
  executeWorkflowReduce,
  WorkflowReduceComputationError,
  workflowReduceConfigurationSha256,
  workflowReduceItemSetSha256,
  workflowReduceProjection,
  workflowReduceValueSetSha256,
} from "./workflow-reduce-model.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowReduceOptions {
  threadId: string;
  planId: string;
  manifestSha256: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowReduceNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowReduceOutcome {
  run: RunRecord;
  output: JsonValue;
}

export class ExecutionPlanWorkflowReduceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowReduceError";
  }
}

export class ExecutionPlanWorkflowReduceRuntime {
  private readonly workerId = createProcessLeaseOwnerId("workflowreduce");

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async execute(
    options: ExecuteExecutionPlanWorkflowReduceOptions,
  ): Promise<ExecutionPlanWorkflowReduceOutcome> {
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
            workflowNodeType: "reduce",
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      let projection: ReturnType<typeof workflowReduceProjection>;
      let output: JsonValue;
      try {
        projection = workflowReduceProjection(options.node, options.input);
        output = executeWorkflowReduce(options.node, projection);
      } catch (error) {
        if (error instanceof WorkflowReduceComputationError) {
          throw new ExecutionPlanWorkflowReduceError(
            error.code,
            error.message,
            leased.run,
          );
        }
        throw error;
      }
      try {
        assertWorkflowEncodedBytes(
          output,
          MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
          `Workflow Reduce output ${options.node.id}`,
        );
        assertWorkflowValue(
          options.node.outputSchema,
          output,
          `Workflow Reduce output ${options.node.id}`,
        );
      } catch {
        throw new ExecutionPlanWorkflowReduceError(
          "output_invalid",
          "Workflow Reduce output does not match its schema",
          leased.run,
        );
      }
      controller.signal.throwIfAborted();
      const serializedOutput = canonicalJson(output);
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
            model: "napier/workflow-reduce",
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
          type: WORKFLOW_REDUCE_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            attempt: options.attempt,
            manifestSha256: options.manifestSha256,
            operation: options.node.operation,
            reduceConfigurationSha256: workflowReduceConfigurationSha256(
              options.node,
            ),
            inputSha256: options.inputSha256,
            itemCount: projection.items.length,
            itemSetSha256: workflowReduceItemSetSha256(projection),
            valueSetSha256: workflowReduceValueSetSha256(projection),
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
          },
        },
        options.onEvent,
      );
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
        terminalEvent: {
          visibility: "debug",
          payload: { status: "completed" },
        },
        onTerminalEvent: options.onEvent,
      });
      settled = true;
      return { run, output };
    } catch (error) {
      if (settled) throw error;
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowReduceError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "reduce_failed";
      const diagnosticSha256 = sha256(errorMessage(error));
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow Reduce ${code}`,
          leaseToken: leased.token,
          terminalEvent: {
            visibility: "user",
            payload: {
              status: cancelled ? "cancelled" : "failed",
              errorCode: code,
              diagnosticSha256,
            },
          },
          onTerminalEvent: options.onEvent,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowReduceError) throw error;
      throw new ExecutionPlanWorkflowReduceError(
        code,
        "Workflow Reduce execution failed",
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
