import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowMapNode,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

import type { AgentRuntime } from "./agent-runtime.js";
import type { EventSink } from "./event-sink.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
} from "./workflow-ledger.js";
import { ExecutionPlanWorkflowMapError } from "./workflow-map-error.js";
import {
  WORKFLOW_MAP_ITEM_COMPLETED_EVENT,
  WORKFLOW_MAP_ITEM_FAILED_EVENT,
  WORKFLOW_MAP_ITEM_STARTED_EVENT,
} from "./workflow-map-evidence.js";
import {
  workflowMapItemContext,
  workflowMapItemInputSha256,
  workflowMapItemPrompt,
  workflowMapNodeConfigurationSha256,
} from "./workflow-map-model.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export interface WorkflowMapItemExecutionOptions {
  threadId: string;
  planId: string;
  manifest: ExecutionPlanWorkflowManifest;
  agentRevision: number;
  node: ExecutionPlanWorkflowMapNode;
  input: JsonValue;
  inputSha256: string;
  attempt: number;
  onEvent?: EventSink;
}

export interface WorkflowMapItemOutcome {
  runId: string;
  inputSha256: string;
  output: JsonValue;
  outputSha256: string;
}

export class ExecutionPlanWorkflowMapItemRuntime {
  constructor(
    private readonly agentRuntime: AgentRuntime,
    private readonly ledger: ExecutionPlanWorkflowLedger,
  ) {}

  async execute(
    options: WorkflowMapItemExecutionOptions,
    coordinator: RunRecord,
    items: JsonValue[],
    signal: AbortSignal,
  ): Promise<WorkflowMapItemOutcome[]> {
    if (items.length === 0) return [];
    const controller = new AbortController();
    const forwardAbort = (): void => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    if (signal.aborted) controller.abort();
    const outcomes = new Array<WorkflowMapItemOutcome>(items.length);
    let nextIndex = 0;
    let failure: unknown;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (failure || controller.signal.aborted) return;
        const itemIndex = nextIndex++;
        if (itemIndex >= items.length) return;
        try {
          outcomes[itemIndex] = await this.executeItem(
            options,
            coordinator,
            items[itemIndex]!,
            itemIndex,
            items.length,
            controller.signal,
          );
        } catch (error) {
          failure ??= error;
          controller.abort();
          return;
        }
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(options.node.maxConcurrency, items.length) },
          () => worker(),
        ),
      );
      if (failure) throw failure;
      signal.throwIfAborted();
      return outcomes;
    } finally {
      signal.removeEventListener("abort", forwardAbort);
    }
  }

  private async executeItem(
    options: WorkflowMapItemExecutionOptions,
    coordinator: RunRecord,
    item: JsonValue,
    itemIndex: number,
    itemCount: number,
    signal: AbortSignal,
  ): Promise<WorkflowMapItemOutcome> {
    const itemContext = workflowMapItemContext(
      options.node,
      options.input,
      item,
      itemIndex,
      itemCount,
    );
    const itemInputSha256 = workflowMapItemInputSha256(
      options.inputSha256,
      itemContext,
    );
    const controller = new AbortController();
    let timedOut = false;
    let childRunId: string | undefined;
    const forwardAbort = (): void => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.node.itemTimeoutMs);
    try {
      const run = await this.agentRuntime.runPrompt({
        threadId: options.threadId,
        text: workflowMapItemPrompt(
          options.manifest,
          options.node,
          itemContext,
        ),
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: options.planId },
        agentRevision: options.agentRevision,
        executionMode: "workflow_map_read_only",
        parentRunId: coordinator.id,
        signal: controller.signal,
        ...(options.node.model ? { model: options.node.model } : {}),
        onRunCreated: async (createdRun) => {
          childRunId = createdRun.id;
          await this.ledger.append(
            {
              threadId: options.threadId,
              runId: createdRun.id,
              type: WORKFLOW_MAP_ITEM_STARTED_EVENT,
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
                planId: options.planId,
                nodeId: options.node.id,
                coordinatorRunId: coordinator.id,
                attempt: options.attempt,
                manifestSha256: options.manifest.contentSha256,
                mapConfigurationSha256: workflowMapNodeConfigurationSha256(
                  options.node,
                ),
                itemIndex,
                itemCount,
                itemInputSha256,
                itemOutputSchemaSha256: workflowSchemaSha256(
                  options.node.outputSchema.items,
                ),
              },
            },
            options.onEvent,
          );
        },
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
      if (timedOut) {
        throw new ExecutionPlanWorkflowMapError(
          "item_timeout",
          "Workflow Map item timed out",
          coordinator,
        );
      }
      if (run.status !== "completed") {
        throw new ExecutionPlanWorkflowMapError(
          `item_run_${run.status}`,
          "Workflow Map item Run did not complete",
          coordinator,
        );
      }
      let output: JsonValue;
      try {
        output = parseExecutionPlanWorkflowNodeOutput(
          await this.ledger.nodeAssistantOutput(options.threadId, run.id),
          options.node.outputSchema.items,
        );
      } catch {
        throw new ExecutionPlanWorkflowMapError(
          "item_output_invalid",
          "Workflow Map item output does not match its schema",
          coordinator,
        );
      }
      const serializedOutput = canonicalJson(output);
      const outputSha256 = sha256(serializedOutput);
      await this.ledger.append(
        {
          threadId: options.threadId,
          runId: run.id,
          type: WORKFLOW_MAP_ITEM_COMPLETED_EVENT,
          category: "plan",
          visibility: "user",
          payload: {
            schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
            planId: options.planId,
            nodeId: options.node.id,
            coordinatorRunId: coordinator.id,
            attempt: options.attempt,
            manifestSha256: options.manifest.contentSha256,
            mapConfigurationSha256: workflowMapNodeConfigurationSha256(
              options.node,
            ),
            itemIndex,
            itemCount,
            itemInputSha256,
            itemOutputSha256: outputSha256,
            itemOutputBytes: Buffer.byteLength(serializedOutput, "utf8"),
            itemOutputSchemaSha256: workflowSchemaSha256(
              options.node.outputSchema.items,
            ),
          },
        },
        options.onEvent,
      );
      return {
        runId: run.id,
        inputSha256: itemInputSha256,
        output,
        outputSha256,
      };
    } catch (error) {
      if (childRunId) {
        await this.ledger
          .append(
            {
              threadId: options.threadId,
              runId: childRunId,
              type: WORKFLOW_MAP_ITEM_FAILED_EVENT,
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
                planId: options.planId,
                nodeId: options.node.id,
                coordinatorRunId: coordinator.id,
                attempt: options.attempt,
                manifestSha256: options.manifest.contentSha256,
                mapConfigurationSha256: workflowMapNodeConfigurationSha256(
                  options.node,
                ),
                itemIndex,
                itemCount,
                itemInputSha256,
                errorCode:
                  error instanceof ExecutionPlanWorkflowMapError
                    ? error.code
                    : timedOut
                      ? "item_timeout"
                      : "item_failed",
                diagnosticSha256: sha256(errorMessage(error)),
              },
            },
            options.onEvent,
          )
          .catch(() => undefined);
      }
      if (error instanceof ExecutionPlanWorkflowMapError) throw error;
      throw new ExecutionPlanWorkflowMapError(
        timedOut ? "item_timeout" : "item_failed",
        "Workflow Map item execution failed",
        coordinator,
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", forwardAbort);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
