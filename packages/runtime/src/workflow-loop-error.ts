import type { RunRecord } from "@napier/contracts";

export class ExecutionPlanWorkflowLoopError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly run?: RunRecord,
  ) {
    super(message);
    this.name = "ExecutionPlanWorkflowLoopError";
  }
}
