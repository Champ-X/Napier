import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
  RunRecord,
} from "@napier/contracts";

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
import { completedWorkflowNodeResult } from "./workflow-runtime-model.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";

export interface WorkflowNodeLifecycleOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export interface WorkflowNodeLifecycleOperations<
  Node extends ExecutionPlanWorkflowNode,
> {
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
  blockNode(
    context: WorkflowExecutionContext,
    node: Node,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
}

interface WorkflowNodeRuntimeOutcome<Output extends JsonValue> {
  run: RunRecord;
  output: Output;
}

interface WorkflowNodeRuntimeLifecycle {
  signal: AbortSignal;
  wasTimedOut(): boolean;
  onRunCreated(run: RunRecord): Promise<void>;
}

interface WorkflowNodeDomainFailure {
  errorCode: string;
  runId?: string;
}

interface WorkflowNodeDomainError extends Error {
  readonly code: string;
  readonly run?: RunRecord | undefined;
}

export function workflowNodeDomainFailure<Arguments extends unknown[]>(
  error: unknown,
  ErrorType: abstract new (...args: Arguments) => WorkflowNodeDomainError,
): WorkflowNodeDomainFailure | undefined {
  if (!(error instanceof ErrorType)) return undefined;
  return {
    errorCode: error.code,
    ...(error.run ? { runId: error.run.id } : {}),
  };
}

export async function executeWorkflowNodeLifecycle<
  Node extends ExecutionPlanWorkflowNode,
  Output extends JsonValue,
>(options: {
  store: LocalStore;
  ledger: ExecutionPlanWorkflowLedger;
  operations: WorkflowNodeLifecycleOperations<Node>;
  context: WorkflowExecutionContext;
  node: Node;
  inputSha256: string;
  attempt: number;
  fallbackErrorCode: string;
  eventMetadata?: Record<string, JsonValue>;
  domainFailure(error: unknown): WorkflowNodeDomainFailure | undefined;
  executeRuntime(
    lifecycle: WorkflowNodeRuntimeLifecycle,
  ): Promise<WorkflowNodeRuntimeOutcome<Output>>;
}): Promise<WorkflowNodeLifecycleOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  let runId: string | undefined;
  const forwardAbort = (): void => controller.abort();
  options.context.signal?.addEventListener("abort", forwardAbort, {
    once: true,
  });
  if (options.context.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.node.timeoutMs);
  try {
    const outcome = await options.executeRuntime({
      signal: controller.signal,
      wasTimedOut: () => timedOut,
      onRunCreated: async (run) => {
        runId = run.id;
        const before = options.store.getPlan(options.context.plan.id);
        const started = await options.store.transitionPlanStep(
          options.context.plan.id,
          options.node.id,
          { action: "start", runId: run.id },
        );
        options.context.plan = started;
        await options.ledger.appendPlanStepEvent(
          options.context,
          started,
          options.node.id,
          "started",
          run.id,
        );
        await options.ledger.append(
          {
            threadId: options.context.threadId,
            runId: run.id,
            type: WORKFLOW_NODE_STARTED_EVENT,
            category: "plan",
            visibility: "user",
            payload: {
              schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
              planId: started.id,
              nodeId: options.node.id,
              ...(options.eventMetadata ??
                workflowNodeEventMetadata(options.node)),
              attempt: options.attempt,
              manifestSha256: options.context.manifest.contentSha256,
              inputSha256: options.inputSha256,
              inputSchemaSha256: workflowSchemaSha256(options.node.inputSchema),
              outputSchemaSha256: workflowSchemaSha256(
                options.node.outputSchema,
              ),
              planRevisionBefore: before.revision,
              planRevisionAfter: started.revision,
              recovered: false,
            },
          },
          options.context.onEvent,
        );
      },
    });
    const outputSha256 = sha256(canonicalJson(outcome.output));
    await options.operations.completePlanStep(
      options.context,
      options.node.id,
      outcome.run.id,
      outputSha256,
    );
    await options.ledger.append(
      {
        threadId: options.context.threadId,
        runId: outcome.run.id,
        type: WORKFLOW_NODE_COMPLETED_EVENT,
        category: "plan",
        visibility: "user",
        payload: {
          schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
          planId: options.context.plan.id,
          nodeId: options.node.id,
          ...(options.eventMetadata ?? workflowNodeEventMetadata(options.node)),
          attempt: options.attempt,
          manifestSha256: options.context.manifest.contentSha256,
          inputSha256: options.inputSha256,
          outputSha256,
          inputSchemaSha256: workflowSchemaSha256(options.node.inputSchema),
          outputSchemaSha256: workflowSchemaSha256(options.node.outputSchema),
          recovered: false,
        },
      },
      options.context.onEvent,
    );
    return {
      result: completedWorkflowNodeResult(
        options.node,
        options.attempt,
        outcome.run.id,
        options.inputSha256,
        outcome.output,
      ),
      cancelled: false,
    };
  } catch (error) {
    const cancelled = options.context.signal?.aborted === true;
    const domainFailure = options.domainFailure(error);
    return {
      result: await options.operations.blockNode(
        options.context,
        options.node,
        {
          ...(domainFailure?.runId
            ? { runId: domainFailure.runId }
            : runId
              ? { runId }
              : {}),
          inputSha256: options.inputSha256,
          attempt: options.attempt,
          errorCode: cancelled
            ? "cancelled"
            : timedOut
              ? "timeout"
              : (domainFailure?.errorCode ?? options.fallbackErrorCode),
          diagnosticSha256: sha256(errorMessage(error)),
        },
      ),
      cancelled,
    };
  } finally {
    clearTimeout(timeout);
    options.context.signal?.removeEventListener("abort", forwardAbort);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
