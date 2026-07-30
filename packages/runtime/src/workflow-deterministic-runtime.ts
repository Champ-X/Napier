import {
  emptyUsage,
  type ExecutionPlanWorkflowDeterministicNode,
  type JsonValue,
  type RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createId } from "./ids.js";
import type { LocalStore } from "./store.js";
import {
  executeExecutionPlanWorkflowDeterministicTemplate,
  executionPlanWorkflowDeterministicTemplateSha256,
} from "./workflow-deterministic-model.js";
import { WORKFLOW_DETERMINISTIC_COMPLETED_EVENT } from "./workflow-deterministic-evidence.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowDeterministicOptions {
  threadId: string;
  planId: string;
  manifestSha256: string;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowDeterministicNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowDeterministicOutcome {
  run: RunRecord;
  output: JsonValue;
}

export class ExecutionPlanWorkflowDeterministicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowDeterministicError";
  }
}

export class ExecutionPlanWorkflowDeterministicRuntime {
  private readonly workerId = createId("workflowdet");

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async execute(
    options: ExecuteExecutionPlanWorkflowDeterministicOptions,
  ): Promise<ExecutionPlanWorkflowDeterministicOutcome> {
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
            workflowNodeType: "deterministic",
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      controller.signal.throwIfAborted();
      let output: JsonValue;
      try {
        output = executeExecutionPlanWorkflowDeterministicTemplate(
          options.node.template,
          options.input,
        );
      } catch {
        throw new ExecutionPlanWorkflowDeterministicError(
          "template_failed",
          "Workflow deterministic template could not resolve its input",
          leased.run,
        );
      }
      try {
        assertWorkflowEncodedBytes(
          output,
          MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
          `Workflow deterministic output ${options.node.id}`,
        );
        assertWorkflowValue(
          options.node.outputSchema,
          output,
          `Workflow deterministic output ${options.node.id}`,
        );
      } catch {
        throw new ExecutionPlanWorkflowDeterministicError(
          "output_invalid",
          "Workflow deterministic output does not match its schema",
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
            model: "napier/workflow-deterministic",
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
          type: WORKFLOW_DETERMINISTIC_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            attempt: options.attempt,
            manifestSha256: options.manifestSha256,
            templateSha256: executionPlanWorkflowDeterministicTemplateSha256(
              options.node.template,
            ),
            inputSha256: options.inputSha256,
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
          },
        },
        options.onEvent,
      );
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
      const run = await this.store.finishRun(leased.run.id, "completed", {
        leaseToken: leased.token,
      });
      settled = true;
      return { run, output };
    } catch (error) {
      if (settled) throw error;
      const timedOut = options.wasTimedOut?.() === true;
      const cancelled = options.signal.aborted && !timedOut;
      const code =
        error instanceof ExecutionPlanWorkflowDeterministicError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "deterministic_failed";
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
          error: `Workflow deterministic ${code}`,
          leaseToken: leased.token,
        })
        .catch(() => undefined);
      if (error instanceof ExecutionPlanWorkflowDeterministicError) throw error;
      throw new ExecutionPlanWorkflowDeterministicError(
        code,
        "Workflow deterministic execution failed",
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
