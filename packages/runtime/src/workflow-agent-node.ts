import type {
  ExecutionPlanWorkflowAgentNode,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

import type { RunPromptOptions } from "./agent-runtime-options.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { WORKFLOW_NODE_EXECUTION } from "./workflow-node-execution.js";
import {
  completedWorkflowNodeResult,
  workflowNodePrompt,
} from "./workflow-runtime-model.js";
import {
  parseExecutionPlanWorkflowNodeOutput,
  workflowSchemaSha256,
} from "./workflow-schemas.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

export interface WorkflowAgentNodeOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export interface WorkflowAgentNodeOperations {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
  blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowAgentNode,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
}

export class ExecutionPlanWorkflowAgentNodeExecutor {
  constructor(
    private readonly store: LocalStore,
    private readonly agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowAgentNodeOperations,
  ) {}

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowAgentNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowAgentNodeOutcome> {
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (context.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, node.timeoutMs);
    let run: RunRecord | undefined;
    try {
      const prompt = workflowNodePrompt(context.manifest, node, input);
      const runOptions: RunPromptOptions = {
        threadId: context.threadId,
        text: prompt,
        source: "workflow",
        [WORKFLOW_NODE_EXECUTION]: { planId: context.plan.id },
        agentRevision: context.agentRevision,
        signal: controller.signal,
        ...(node.model ? { model: node.model } : {}),
        onRunCreated: async (createdRun) => {
          run = createdRun;
          const before = this.store.getPlan(context.plan.id);
          const started = await this.store.transitionPlanStep(
            context.plan.id,
            node.id,
            { action: "start", runId: createdRun.id },
          );
          context.plan = started;
          await this.ledger.appendPlanStepEvent(
            context,
            started,
            node.id,
            "started",
            createdRun.id,
          );
          await this.ledger.append(
            {
              threadId: context.threadId,
              runId: createdRun.id,
              type: WORKFLOW_NODE_STARTED_EVENT,
              category: "plan",
              visibility: "user",
              payload: {
                schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
                planId: started.id,
                nodeId: node.id,
                ...workflowNodeEventMetadata(node),
                attempt,
                manifestSha256: context.manifest.contentSha256,
                inputSha256,
                inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
                outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
                planRevisionBefore: before.revision,
                planRevisionAfter: started.revision,
                recovered: false,
              },
            },
            context.onEvent,
          );
        },
        ...(context.onEvent ? { onEvent: context.onEvent } : {}),
      };
      run = await this.agentExecution.runPrompt(runOptions);
    } catch (error) {
      const cancelled = context.signal?.aborted === true;
      const errorCode = cancelled
        ? "cancelled"
        : timedOut
          ? "timeout"
          : "run_start_failed";
      return {
        result: await this.operations.blockNode(context, node, {
          ...(run ? { runId: run.id } : {}),
          inputSha256,
          attempt,
          errorCode,
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled,
      };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", forwardAbort);
    }

    if (!run) throw new Error("Workflow node Run was not created");
    if (context.signal?.aborted) {
      return {
        result: await this.operations.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "cancelled",
          diagnosticSha256: sha256(run.error ?? "cancelled"),
        }),
        cancelled: true,
      };
    }
    if (timedOut) {
      return {
        result: await this.operations.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "timeout",
          diagnosticSha256: sha256(run.error ?? "timeout"),
        }),
        cancelled: false,
      };
    }
    if (run.status !== "completed") {
      return {
        result: await this.operations.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: `run_${run.status}`,
          diagnosticSha256: sha256(run.error ?? run.status),
        }),
        cancelled: false,
      };
    }

    let output: JsonValue;
    try {
      output = parseExecutionPlanWorkflowNodeOutput(
        await this.ledger.nodeAssistantOutput(context.threadId, run.id),
        node.outputSchema,
      );
    } catch (error) {
      return {
        result: await this.operations.blockNode(context, node, {
          runId: run.id,
          inputSha256,
          attempt,
          errorCode: "output_invalid",
          diagnosticSha256: sha256(errorMessage(error)),
        }),
        cancelled: false,
      };
    }
    const outputSha256 = sha256(canonicalJson(output));
    await this.operations.completePlanStep(
      context,
      node.id,
      run.id,
      outputSha256,
    );
    await this.ledger.append(
      {
        threadId: context.threadId,
        runId: run.id,
        type: WORKFLOW_NODE_COMPLETED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: context.plan.id,
          nodeId: node.id,
          ...workflowNodeEventMetadata(node),
          attempt,
          manifestSha256: context.manifest.contentSha256,
          inputSha256,
          outputSha256,
          inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
          recovered: false,
        },
      },
      context.onEvent,
    );
    return {
      result: completedWorkflowNodeResult(
        node,
        attempt,
        run.id,
        inputSha256,
        output,
      ),
      cancelled: false,
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
