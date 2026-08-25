import type {
  ExecutionPlanWorkflowJavascriptNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import { ExecutionPlanWorkflowJavascriptRuntime } from "./workflow-javascript-runtime.js";
import { ExecutionPlanWorkflowKernelError } from "./workflow-kernel-run.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";
import type { WorkflowRuntimeEnvironment } from "./workflow-runtime-ports.js";

export interface WorkflowJavascriptNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowJavascriptNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowJavascriptNode> {}

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
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "javascript_failed",
      domainFailure: (error) =>
        workflowNodeDomainFailure(error, ExecutionPlanWorkflowKernelError),
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
