export const WORKFLOW_NODE_EXECUTION: unique symbol = Symbol(
  "napier.workflow-node-execution",
);

export interface WorkflowNodeExecution {
  planId: string;
}
