import type {
  ExecutionPlanWorkflowJavascriptNode,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { LocalStore } from "./store.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import { ExecutionPlanWorkflowJavascriptRuntime } from "./workflow-javascript-runtime.js";
import { ExecutionPlanWorkflowKernelError } from "./workflow-kernel-run.js";
import {
  ExecutionPlanWorkflowLedger,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_NODE_COMPLETED_EVENT,
  WORKFLOW_NODE_STARTED_EVENT,
  workflowNodeEventMetadata,
} from "./workflow-ledger.js";
import { completedWorkflowNodeResult } from "./workflow-runtime-model.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";
import type { WorkflowRuntimeEnvironment } from "./workflow-runtime-ports.js";

export interface WorkflowJavascriptNodeOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export interface WorkflowJavascriptNodeOperations {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
  blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowJavascriptNode,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
}

export class ExecutionPlanWorkflowJavascriptNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowJavascriptRuntime;

  constructor(
    private readonly store: LocalStore,
    environment: WorkflowRuntimeEnvironment,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowJavascriptNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowJavascriptRuntime(
      store,
      ledger,
      environment.workspaceProcesses,
    );
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowJavascriptNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowJavascriptNodeOutcome> {
    const controller = new AbortController();
    let timedOut = false;
    let runId: string | undefined;
    const forwardAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (context.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, node.timeoutMs);
    try {
      const outcome = await this.runtime.execute({
        threadId: context.threadId,
        planId: context.plan.id,
        manifestSha256: context.manifest.contentSha256,
        agentId: context.agentId,
        agentRevision: context.agentRevision,
        node,
        input,
        inputSha256,
        attempt,
        signal: controller.signal,
        wasTimedOut: () => timedOut,
        ...(context.onEvent ? { onEvent: context.onEvent } : {}),
        onRunCreated: async (run) => {
          runId = run.id;
          const before = this.store.getPlan(context.plan.id);
          const started = await this.store.transitionPlanStep(
            context.plan.id,
            node.id,
            { action: "start", runId: run.id },
          );
          context.plan = started;
          await this.ledger.appendPlanStepEvent(
            context,
            started,
            node.id,
            "started",
            run.id,
          );
          await this.ledger.append(
            {
              threadId: context.threadId,
              runId: run.id,
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
      });
      const outputSha256 = sha256(canonicalJson(outcome.output));
      await this.operations.completePlanStep(
        context,
        node.id,
        outcome.run.id,
        outputSha256,
      );
      await this.ledger.append(
        {
          threadId: context.threadId,
          runId: outcome.run.id,
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
          outcome.run.id,
          inputSha256,
          outcome.output,
        ),
        cancelled: false,
      };
    } catch (error) {
      const cancelled = context.signal?.aborted === true;
      const errorCode = cancelled
        ? "cancelled"
        : timedOut
          ? "timeout"
          : error instanceof ExecutionPlanWorkflowKernelError
            ? error.code
            : "javascript_failed";
      return {
        result: await this.operations.blockNode(context, node, {
          ...(error instanceof ExecutionPlanWorkflowKernelError && error.run
            ? { runId: error.run.id }
            : runId
              ? { runId }
              : {}),
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
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
