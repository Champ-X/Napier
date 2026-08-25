import type {
  ExecutionPlanWorkflowToolNode,
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
import type { WorkflowRuntimeEnvironment } from "./workflow-runtime-ports.js";
import {
  ExecutionPlanWorkflowToolError,
  ExecutionPlanWorkflowToolRuntime,
} from "./workflow-tool-runtime.js";

export interface WorkflowToolNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowToolNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowToolNode> {}

export class ExecutionPlanWorkflowToolNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowToolRuntime;

  constructor(
    private readonly store: LocalStore,
    environment: WorkflowRuntimeEnvironment,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowToolNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowToolRuntime(
      store,
      environment,
      ledger,
    );
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowToolNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowToolNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "tool_failed",
      eventMetadata: {
        nodeType: node.type,
        toolName: node.tool,
        effect: node.effect,
      },
      domainFailure: (error) =>
        workflowNodeDomainFailure(error, ExecutionPlanWorkflowToolError),
      executeRuntime: (lifecycle) =>
        this.runtime.execute({
          threadId: context.threadId,
          planId: context.plan.id,
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
