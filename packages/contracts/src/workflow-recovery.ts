/** Availability is a historical checkpoint, revalidated by the Runtime on use. */
export interface WorkflowRecoveryCheckpoint {
  schemaVersion: 1;
  threadId: string;
  planId: string;
  status: "ready" | "waiting_answer" | "completed" | "unavailable" | "busy";
  action?: "resume" | "continue_breakpoint" | "retry_blocked";
  checkpointSha256?: string;
  manifestSha256?: string;
  name?: string;
  decisionId?: string;
  reason?:
    | "definition_unavailable"
    | "binding_mismatch"
    | "evidence_limit"
    | "ambiguous_breakpoint";
}

export interface RecoverWorkflowRequest {
  checkpointSha256: string;
}
