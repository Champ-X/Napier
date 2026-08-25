import type {
  ExecutionPlanWorkflowMapNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { ExecutionPlanWorkflowMapError } from "./workflow-map-error.js";
import { ExecutionPlanWorkflowMapRuntime } from "./workflow-map-runtime.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";
import type { WorkflowAgentExecutionPort } from "./workflow-runtime-ports.js";

export interface WorkflowMapNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowMapNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowMapNode> {}

export class ExecutionPlanWorkflowMapNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowMapRuntime;

  constructor(
    private readonly store: LocalStore,
    agentExecution: WorkflowAgentExecutionPort,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowMapNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowMapRuntime(
      store,
      agentExecution,
      ledger,
    );
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowMapNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowMapNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "map_failed",
      domainFailure: (error) =>
        workflowNodeDomainFailure(error, ExecutionPlanWorkflowMapError),
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
