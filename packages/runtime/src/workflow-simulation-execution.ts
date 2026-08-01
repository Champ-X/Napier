export const WORKFLOW_SIMULATION_EXECUTION: unique symbol = Symbol(
  "napier.workflow-simulation-execution",
);

export interface WorkflowSimulationExecution {
  planId: string;
  nodeId: string;
  outputSha256: string;
}
