import type {
  ExecutionPlanWorkflowNode,
  ExecutionPlanWorkflowNodeResult,
  JsonValue,
} from "@napier/contracts";

import type { LocalStore } from "./store.js";
import { ExecutionPlanWorkflowAgentNodeExecutor } from "./workflow-agent-node.js";
import { ExecutionPlanWorkflowApprovalNodeExecutor } from "./workflow-approval-node.js";
import type {
  WorkflowExecutionContext,
  WorkflowNodeFailure,
} from "./workflow-context.js";
import { ExecutionPlanWorkflowDeterministicNodeExecutor } from "./workflow-deterministic-node.js";
import { ExecutionPlanWorkflowJavascriptNodeExecutor } from "./workflow-javascript-node.js";
import type { ExecutionPlanWorkflowLedger } from "./workflow-ledger.js";
import { ExecutionPlanWorkflowLoopNodeExecutor } from "./workflow-loop-node.js";
import { ExecutionPlanWorkflowMapNodeExecutor } from "./workflow-map-node.js";
import { ExecutionPlanWorkflowPythonNodeExecutor } from "./workflow-python-node.js";
import { ExecutionPlanWorkflowReduceNodeExecutor } from "./workflow-reduce-node.js";
import { ExecutionPlanWorkflowToolNodeExecutor } from "./workflow-tool-node.js";
import type {
  WorkflowAgentExecutionPort,
  WorkflowRuntimeEnvironment,
} from "./workflow-runtime-ports.js";

export interface WorkflowNodeExecutionOutcome {
  result: ExecutionPlanWorkflowNodeResult;
  cancelled: boolean;
}

export interface WorkflowNodeDispatcherOperations {
  blockNode(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
    failure: WorkflowNodeFailure,
  ): Promise<ExecutionPlanWorkflowNodeResult>;
  completePlanStep(
    context: WorkflowExecutionContext,
    nodeId: string,
    runId: string,
    outputSha256: string,
  ): Promise<void>;
}

export class ExecutionPlanWorkflowNodeDispatcher {
  private readonly agent: ExecutionPlanWorkflowAgentNodeExecutor;
  private readonly approval: ExecutionPlanWorkflowApprovalNodeExecutor;
  private readonly deterministic: ExecutionPlanWorkflowDeterministicNodeExecutor;
  private readonly javascript: ExecutionPlanWorkflowJavascriptNodeExecutor;
  private readonly loop: ExecutionPlanWorkflowLoopNodeExecutor;
  private readonly map: ExecutionPlanWorkflowMapNodeExecutor;
  private readonly python: ExecutionPlanWorkflowPythonNodeExecutor;
  private readonly reduce: ExecutionPlanWorkflowReduceNodeExecutor;
  private readonly tool: ExecutionPlanWorkflowToolNodeExecutor;

  constructor(
    store: LocalStore,
    agentExecution: WorkflowAgentExecutionPort,
    environment: WorkflowRuntimeEnvironment,
    ledger: ExecutionPlanWorkflowLedger,
    operations: WorkflowNodeDispatcherOperations,
  ) {
    this.agent = new ExecutionPlanWorkflowAgentNodeExecutor(
      store,
      agentExecution,
      ledger,
      operations,
    );
    this.approval = new ExecutionPlanWorkflowApprovalNodeExecutor(
      store,
      ledger,
      operations,
    );
    this.deterministic = new ExecutionPlanWorkflowDeterministicNodeExecutor(
      store,
      ledger,
      operations,
    );
    this.javascript = new ExecutionPlanWorkflowJavascriptNodeExecutor(
      store,
      environment,
      ledger,
      operations,
    );
    this.loop = new ExecutionPlanWorkflowLoopNodeExecutor(
      store,
      agentExecution,
      ledger,
      operations,
    );
    this.map = new ExecutionPlanWorkflowMapNodeExecutor(
      store,
      agentExecution,
      ledger,
      operations,
    );
    this.python = new ExecutionPlanWorkflowPythonNodeExecutor(
      store,
      environment,
      ledger,
      operations,
    );
    this.reduce = new ExecutionPlanWorkflowReduceNodeExecutor(
      store,
      ledger,
      operations,
    );
    this.tool = new ExecutionPlanWorkflowToolNodeExecutor(
      store,
      environment,
      ledger,
      operations,
    );
  }

  recoverRunningApprovals(context: WorkflowExecutionContext): Promise<void> {
    return this.approval.recoverRunning(context);
  }

  execute(
    context: WorkflowExecutionContext,
    node: ExecutionPlanWorkflowNode,
    input: JsonValue,
    inputSha256: string,
    attempt: number,
  ): Promise<WorkflowNodeExecutionOutcome> {
    if (node.type === "deterministic") {
      return this.deterministic.execute(
        context,
        node,
        input,
        inputSha256,
        attempt,
      );
    }
    if (node.type === "map") {
      return this.map.execute(context, node, input, inputSha256, attempt);
    }
    if (node.type === "loop") {
      return this.loop.execute(context, node, input, inputSha256, attempt);
    }
    if (node.type === "reduce") {
      return this.reduce.execute(context, node, input, inputSha256, attempt);
    }
    if (node.type === "javascript") {
      return this.javascript.execute(
        context,
        node,
        input,
        inputSha256,
        attempt,
      );
    }
    if (node.type === "python") {
      return this.python.execute(context, node, input, inputSha256, attempt);
    }
    if (node.type === "approval") {
      return this.approval.execute(context, node, input, inputSha256, attempt);
    }
    if (node.type === "tool") {
      return this.tool.execute(context, node, input, inputSha256, attempt);
    }
    return this.agent.execute(context, node, input, inputSha256, attempt);
  }
}
