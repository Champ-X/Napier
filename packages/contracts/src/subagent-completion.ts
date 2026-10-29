import type { SubagentLogicalIdentity } from "./subagent-continuation.js";

/** Private content is referenced by digest; the immutable producer is never rewritten. */
export interface SubagentCompletionCandidate {
  id: string;
  sourceSha256: string;
}

export interface SubagentCompletionReservation extends SubagentLogicalIdentity {
  kind: "napier.subagent-completion-reservation";
  schemaVersion: 1;
  logicalCompletionKey: string;
  producerTaskId: string;
  producerRunId: string;
  producerExecutionId: string;
  payloadSha256: string;
  createdAt: string;
  candidate?: SubagentCompletionCandidate;
}

/** Installed atomically with Task/child Run terminal state and delivery events. */
export interface SubagentCompletionReceipt {
  kind: "napier.subagent-completion";
  schemaVersion: 1;
  reservation: SubagentCompletionReservation;
  committedAt: string;
  contentSha256: string;
}
