import type {
  ExecutionPlanWorkflowReduceNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";
import {
  ExecutionPlanWorkflowReduceError,
  ExecutionPlanWorkflowReduceRuntime,
} from "./workflow-reduce-runtime.js";

export interface WorkflowReduceNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowReduceNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowReduceNode> {}

export class ExecutionPlanWorkflowReduceNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowReduceRuntime;

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowReduceNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowReduceRuntime(store, ledger);
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowReduceNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowReduceNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "reduce_failed",
      domainFailure: (error) =>
        workflowNodeDomainFailure(error, ExecutionPlanWorkflowReduceError),
      executeRuntime: (lifecycle) =>
        this.runtime.execute({
          threadId: context.threadId,
          planId: context.plan.id,
          manifestSha256: context.manifest.contentSha256,
          agentId: context.agentId,
          agentRevision: context.agentRevision,
          node,
          input,
          inputSha256,
          attempt,
          signal: lifecycle.signal,
          wasTimedOut: lifecycle.wasTimedOut,
          ...(context.onEvent ? { onEvent: context.onEvent } : {}),
          onRunCreated: lifecycle.onRunCreated,
        }),
    });
  }
}
