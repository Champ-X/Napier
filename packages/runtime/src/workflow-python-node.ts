import type {
  ExecutionPlanWorkflowPythonNode,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import type { WorkflowExecutionContext } from "./workflow-context.js";
import { ExecutionPlanWorkflowKernelError } from "./workflow-kernel-run.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import {
  executeWorkflowNodeLifecycle,
  type WorkflowNodeLifecycleOperations,
  type WorkflowNodeLifecycleOutcome,
  workflowNodeDomainFailure,
} from "./workflow-node-lifecycle.js";
import { ExecutionPlanWorkflowPythonRuntime } from "./workflow-python-runtime.js";
import type { WorkflowRuntimeEnvironment } from "./workflow-runtime-ports.js";

export interface WorkflowPythonNodeOutcome extends WorkflowNodeLifecycleOutcome {}

export interface WorkflowPythonNodeOperations extends WorkflowNodeLifecycleOperations<ExecutionPlanWorkflowPythonNode> {}

export class ExecutionPlanWorkflowPythonNodeExecutor {
  private readonly runtime: ExecutionPlanWorkflowPythonRuntime;

  constructor(
    private readonly store: LocalStore,
    environment: WorkflowRuntimeEnvironment,
    private readonly ledger: ExecutionPlanWorkflowLedger,
    private readonly operations: WorkflowPythonNodeOperations,
  ) {
    this.runtime = new ExecutionPlanWorkflowPythonRuntime(
      store,
      ledger,
      environment.workspaceProcesses,
    );
  }

  async execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowPythonNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowPythonNodeOutcome> {
    return executeWorkflowNodeLifecycle({
      store: this.store,
      ledger: this.ledger,
      operations: this.operations,
      context,
      node,
      inputSha256,
      attempt,
      fallbackErrorCode: "python_failed",
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
