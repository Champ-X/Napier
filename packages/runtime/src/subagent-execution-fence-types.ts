import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";

export interface SubagentChildRunFence {
  runId: string;
  taskId: string;
  executionId: string;
  token: string;
  expectedExecutionRevision?: number;
}
export interface SubagentChildRunState {
  run: RunRecord;
  task: SubagentTask;
  executionRevision: number;
  /** Newly committed events for best-effort publication outside the transaction. */
  events?: RunEvent[];
}
export interface SubagentChildCheckpointFence extends SubagentChildRunFence {
  expectedExecutionRevision: number;
}
