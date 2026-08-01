import type {
  WorkflowExperimentLineage,
  WorkflowNodeInputOverride,
  WorkflowReusedNode,
  WorkflowSimulatedNode,
} from "./workflow-context.js";

export const WORKFLOW_EXPERIMENT_EXECUTION: unique symbol = Symbol(
  "napier.workflow-experiment-execution",
);

export interface WorkflowExperimentExecution {
  agentRevision: number;
  lineage: WorkflowExperimentLineage;
  reusedNodes: WorkflowReusedNode[];
  simulatedNodes: WorkflowSimulatedNode[];
  inputOverrides: WorkflowNodeInputOverride[];
}
