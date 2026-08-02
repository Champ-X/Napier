import type {
  ExecutionPlanWorkflowResult,
  OperatorDecision,
} from "@napier/contracts";

export interface EmbeddedWorkflowExecution {
  threadId: string;
  result: ExecutionPlanWorkflowResult;
  pendingDecision?: OperatorDecision;
}
