import type {
  JsonValue,
  ModelRef,
  SubagentRole,
  Usage,
} from "./execution-core.js";
import type { WorkflowValueSchema } from "./execution-workflows.js";
import type { ModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import type { ModelRouteRequest } from "./model-route.js";

/** Durable compatibility state used by the existing task projections. */
export type SubagentTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export type SubagentStopReason =
  | "completed"
  | "turn_capped"
  | "timeout"
  | "cancelled"
  | "error";

export type SubagentSupervisorStatus =
  | "queued"
  | "starting"
  | "running"
  | "waiting_input"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "orphaned";

export type SubagentSupervisorTerminalStatus = Extract<
  SubagentSupervisorStatus,
  "completed" | "failed" | "cancelled" | "timed_out" | "orphaned"
>;

export interface SubagentHandle {
  kind: "napier.subagent-handle";
  schemaVersion: 1;
  providerId: string;
  taskId: string;
  executionId: string;
}

export interface SubagentRequest {
  kind: "napier.subagent-request";
  schemaVersion: 1;
  threadId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  prompt: string;
  modelRoute?: ModelRouteRequest;
  outputSchema?: WorkflowValueSchema;
  writePaths?: string[];
  revivedFromTaskId?: string;
}

export type SubagentMessageKind = "steering" | "input";

export interface SubagentMessage {
  kind: "napier.subagent-message";
  schemaVersion: 1;
  id: string;
  taskId: string;
  messageKind: SubagentMessageKind;
  text: string;
  createdAt: string;
  contentSha256: string;
}

export interface SubagentMailboxSnapshot {
  acceptedCount: number;
  deliveredCount: number;
  pendingCount: number;
  lastAcceptedAt?: string;
  lastDeliveredAt?: string;
}

export interface SubagentSnapshot {
  kind: "napier.subagent-snapshot";
  schemaVersion: 1;
  handle: SubagentHandle;
  status: SubagentSupervisorStatus;
  taskStatus: SubagentTaskStatus;
  role: SubagentRole;
  model: ModelRef;
  routePlanId?: string;
  stepCount: number;
  turnCount: number;
  mailbox: SubagentMailboxSnapshot;
  taskRevision: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: SubagentStopReason;
  outcomeSha256?: string;
  errorSha256?: string;
}

export interface SubagentCollectedOutcome {
  kind: "napier.subagent-collected-outcome";
  schemaVersion: 1;
  handle: SubagentHandle;
  status: SubagentSupervisorTerminalStatus;
  task: SubagentTask;
  outcome?: SubagentOutcome;
  output?: JsonValue;
  outputSchemaSha256?: string;
  providerResult?: JsonValue;
}

export type SubagentOutcomeItemKind =
  | "finding"
  | "risk"
  | "recommendation";
export type SubagentOutcomeSeverity = "info" | "warning" | "blocker";

export interface SubagentOutcomeEvidence {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  fileSha256?: string;
  rangeSha256?: string;
  fileSizeBytes?: number;
  observedLineCount?: number;
}

export interface SubagentOutcomeItem {
  kind: SubagentOutcomeItemKind;
  severity: SubagentOutcomeSeverity;
  title: string;
  detail: string;
  evidence: SubagentOutcomeEvidence[];
}

export interface SubagentOutcome {
  kind: "napier.subagent-outcome";
  schemaVersion: 1 | 2;
  taskId: string;
  role: SubagentRole;
  model: ModelRef;
  summary: string;
  items: SubagentOutcomeItem[];
  unknowns: string[];
  itemCount: number;
  unknownCount: number;
  evidenceCount?: number;
  promptSha256: string;
  instructionsSha256: string;
  resultSha256: string;
  itemSetSha256: string;
  evidenceSetSha256?: string;
  contentSha256: string;
}

export interface GroundedSubagentOutcome extends SubagentOutcome {
  schemaVersion: 2;
  evidenceCount: number;
  evidenceSetSha256: string;
}

export interface SubagentOutcomeRepairRequestPayload {
  kind: "napier.subagent-outcome-repair-request";
  schemaVersion: 1;
  taskId: string;
  role: SubagentRole;
  model: ModelRef;
  attempt: number;
  maxAttempts: number;
  taskPromptSha256: string;
  outcomeInstructionsSha256: string;
  predecessorResultSha256: string;
  predecessorResultBytes: number;
  diagnosticSha256: string;
  repairInstructionsSha256: string;
  repairPromptSha256: string;
  contentSha256: string;
}

export type SubagentOutcomeRepairStatus = "accepted" | "rejected" | "error";

export interface SubagentOutcomeRepairOutcomePayload {
  kind: "napier.subagent-outcome-repair-outcome";
  schemaVersion: 1;
  taskId: string;
  status: SubagentOutcomeRepairStatus;
  attempt: number;
  maxAttempts: number;
  requestContentSha256: string;
  resultSha256?: string;
  outcomeSha256?: string;
  diagnosticSha256?: string;
  contentSha256: string;
}

export interface ReviewSubagentOutcomeRequest {
  model: ModelRef;
}

export type SubagentOutcomeReviewVerdict =
  | "accept"
  | "revise"
  | "reject"
  | "inconclusive";
export type SubagentOutcomeReviewRisk = "low" | "medium" | "high";

export interface SubagentOutcomeReview {
  kind: "napier.subagent-outcome-review";
  schemaVersion: 1;
  policyId: "napier.subagent-outcome-review.v1";
  taskId: string;
  role: SubagentRole;
  outcomeSha256: string;
  workerModel: ModelRef;
  reviewerModel: ModelRef;
  verdict: SubagentOutcomeReviewVerdict;
  score: number;
  risk: SubagentOutcomeReviewRisk;
  reason: string;
  concerns: string[];
  criteria: string[];
  itemCount: number;
  unknownCount: number;
  evidenceCount: number;
  usage: Usage;
  criteriaSha256: string;
  inputSha256: string;
  promptSha256: string;
  responseSha256: string;
  reviewSchemaSha256: string;
  modelContextEnvelope?: ModelContextEnvelopeReceipt;
  createdAt: string;
  reviewSha256: string;
}

export type SubagentOutcomeEvidenceVerificationItemStatus =
  | "aligned"
  | "divergent"
  | "missing";

export interface SubagentOutcomeEvidenceVerificationItem {
  path: string;
  lineStart?: number;
  lineEnd?: number;
  status: SubagentOutcomeEvidenceVerificationItemStatus;
  expectedFileSha256: string;
  observedFileSha256?: string;
  expectedRangeSha256: string;
  observedRangeSha256?: string;
  diagnosticSha256?: string;
}

export interface SubagentOutcomeEvidenceVerification {
  kind: "napier.subagent-outcome-evidence-verification";
  schemaVersion: 1;
  status: "aligned" | "divergent" | "unavailable";
  taskId: string;
  outcomeSha256: string;
  evidenceCount: number;
  alignedCount: number;
  divergentCount: number;
  missingCount: number;
  items: SubagentOutcomeEvidenceVerificationItem[];
  contentSha256: string;
}

export interface SubagentTask {
  id: string;
  threadId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  prompt: string;
  status: SubagentTaskStatus;
  result?: string;
  outcome?: SubagentOutcome;
  error?: string;
  stopReason?: SubagentStopReason;
  model: ModelRef;
  providerId?: string;
  executionId?: string;
  supervisorStatus?: SubagentSupervisorStatus;
  output?: JsonValue;
  outputSchema?: WorkflowValueSchema;
  outputSchemaSha256?: string;
  routePlanId?: string;
  revivedFromTaskId?: string;
  failureContextSha256?: string;
  stepCount: number;
  turnCount: number;
  usage: Usage;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  revision: number;
}

export interface DelegationLedgerTaskProjection {
  taskId: string;
  runId: string;
  role: SubagentRole;
  status: SubagentTaskStatus;
  description: string;
  descriptionSha256: string;
  promptSha256: string;
  intentSha256: string;
  model: ModelRef;
  stepCount: number;
  turnCount: number;
  revision: number;
  createdAt: string;
  finishedAt?: string;
  stopReason?: SubagentStopReason;
  resultSha256?: string;
  errorSha256?: string;
  outcomeSha256?: string;
  itemCount?: number;
  unknownCount?: number;
  evidenceCount?: number;
}

export interface DelegationLedgerProjection {
  kind: "napier.delegation-ledger-projection";
  schemaVersion: 1;
  threadId: string;
  taskCount: number;
  selectedTaskCount: number;
  activeTaskCount: number;
  terminalTaskCount: number;
  omittedTaskCount: number;
  statusCounts: Record<SubagentTaskStatus, number>;
  tasks: DelegationLedgerTaskProjection[];
  taskSetSha256: string;
  contentSha256: string;
}
