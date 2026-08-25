import type {
  ExecutionPlanWorkflowLoopNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { ExecutionPlanWorkflowLoopError } from "./workflow-loop-error.js";
import { ExecutionPlanWorkflowLoopRuntime } from "./workflow-loop-runtime.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

export interface WorkflowLoopNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowLoopNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowLoopNode> {}

export class ExecutionPlanWorkflowLoopNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowLoopRuntime;

  constructor(
    private readonly store: LocalStore,
    agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowLoopNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowLoopRuntime(
      store,
      agentExecution,
      ledger,
    );
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowLoopNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowLoopNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "loop_failed",
      domainFailure: (error) =>
        workflowNodeDomainFailure(error, ExecutionPlanWorkflowLoopError),
      executeRuntime: (lifecycle) =>
        this.runtime.execute({
          threadId: context.threadId,
          planId: context.plan.id,
          manifest: context.manifest,
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
