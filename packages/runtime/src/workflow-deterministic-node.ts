import type {
  ExecutionPlanWorkflowDeterministicNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import {
  ExecutionPlanWorkflowDeterministicError,
  ExecutionPlanWorkflowDeterministicRuntime,
} from "./workflow-deterministic-runtime.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";

export interface WorkflowDeterministicNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowDeterministicNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowDeterministicNode> {}

export class ExecutionPlanWorkflowDeterministicNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowDeterministicRuntime;

  constructor(
    private readonly store: LocalStore,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowDeterministicNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowDeterministicRuntime(store, ledger);
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowDeterministicNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowDeterministicNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "deterministic_failed",
      domainFailure: (error) =>
        workflowNodeDomainFailure(
          error,
          ExecutionPlanWorkflowDeterministicError,
        ),
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
