import {
  emptyUsage,
  type ExecutionPlanWorkflowManifest,
  type ExecutionPlanWorkflowMapNode,
  type JsonValue,
  type RunRecord,
} from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore } from "./store.js";
import {
  WORKFLOW_EVENT_SCHEMA_VERSION,
  ExecutionPlanWorkflowLedger,
} from "./workflow-ledger.js";
import { ExecutionPlanWorkflowMapError } from "./workflow-map-error.js";
import { WORKFLOW_MAP_COMPLETED_EVENT } from "./workflow-map-evidence.js";
import { ExecutionPlanWorkflowMapItemRuntime } from "./workflow-map-item-runtime.js";
import {
  workflowMapItems,
  workflowMapNodeConfigurationSha256,
} from "./workflow-map-model.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  assertWorkflowEncodedBytes,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

const RUN_LEASE_TTL_MS = 60_000;
const RUN_LEASE_HEARTBEAT_MS = 20_000;

export interface ExecuteExecutionPlanWorkflowMapOptions {
  threadId: string;
  planId: string;
  manifest: ExecutionPlanWorkflowManifest;
  agentId: string;
  agentRevision: number;
  node: ExecutionPlanWorkflowMapNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  signal: AbortSignal;
  wasTimedOut?(): boolean;
  onEvent?: EventSink;
  onRunCreated(run: RunRecord): Promise<void>;
}

export interface ExecutionPlanWorkflowMapOutcome {
  run: RunRecord;
  output: JsonValue[];
}

export class ExecutionPlanWorkflowMapRuntime {
  private readonly workerId = createProcessLeaseOwnerId("workflowmap");
  private readonly items: ExecutionPlanWorkflowMapItemRuntime;

  constructor(
    private readonly store: LocalStore,
    agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {
    this.items = new ExecutionPlanWorkflowMapItemRuntime(
      agentExecution,
      ledger,
    );
  }

  async execute(
    options: ExecuteExecutionPlanWorkflowMapOptions,
  ): Promise<ExecutionPlanWorkflowMapOutcome> {
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
        model: options.node.model ?? profile.model,
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
            model: `${leased.run.configuration?.model.provider ?? "unknown"}/${leased.run.configuration?.model.id ?? "unknown"}`,
            source: "workflow",
            workflowNodeType: "map",
            configurationSha256: leased.run.configuration?.contentSha256 ?? "",
          },
        },
        options.onEvent,
      );
      const items = workflowMapItems(options.node, options.input);
      const itemOutcomes = await this.items.execute(
        options,
        leased.run,
        items,
        controller.signal,
      );
      const output = itemOutcomes.map((item) => structuredClone(item.output));
      assertWorkflowEncodedBytes(
        output,
        MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
        `Workflow Map output ${options.node.id}`,
      );
      assertWorkflowValue(
        options.node.outputSchema,
        output,
        `Workflow Map output ${options.node.id}`,
      );
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
            model: "napier/workflow-map",
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
          type: WORKFLOW_MAP_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            attempt: options.attempt,
            manifestSha256: options.manifest.contentSha256,
            mapConfigurationSha256: workflowMapNodeConfigurationSha256(
              options.node,
            ),
            inputSha256: options.inputSha256,
            outputSha256,
            outputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
            itemOutputSchemaSha256: workflowSchemaSha256(
              options.node.outputSchema.items,
            ),
            itemCount: items.length,
            maxConcurrency: options.node.maxConcurrency,
            itemInputSetSha256: sha256(
              canonicalJson(itemOutcomes.map((item) => item.inputSha256)),
            ),
            itemOutputSetSha256: sha256(
              canonicalJson(itemOutcomes.map((item) => item.outputSha256)),
            ),
            itemRunSetSha256: sha256(
              canonicalJson(itemOutcomes.map((item) => item.runId)),
            ),
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
        error instanceof ExecutionPlanWorkflowMapError
          ? error.code
          : leaseLost
            ? "lease_lost"
            : timedOut
              ? "timeout"
              : cancelled
                ? "cancelled"
                : "map_failed";
      const diagnosticSha256 = sha256(errorMessage(error));
      await this.store
        .finishRun(leased.run.id, cancelled ? "cancelled" : "failed", {
          error: `Workflow Map ${code}`,
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
      if (error instanceof ExecutionPlanWorkflowMapError) throw error;
      throw new ExecutionPlanWorkflowMapError(
        code,
        "Workflow Map execution failed",
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
