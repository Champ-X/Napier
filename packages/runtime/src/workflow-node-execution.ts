export const WORKFLOW_NODE_EXECUTION: unique symbol = Symbol(
  "napier.workflow-node-execution",
);

export interface WorkflowNodeExecution {
  planId: string;
}

export function isWorkflowRunSource(source: string | undefined): boolean {
  return (
    source === "workflow" ||
    source === "workflow_reuse" ||
    source === "workflow_simulation"
  );
}
