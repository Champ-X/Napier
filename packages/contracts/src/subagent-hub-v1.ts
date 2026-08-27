import type {
  JsonValue,
  ModelRef,
  SubagentRole,
  Usage,
} from "./execution-core.js";
import type {
  SubagentMessageKind,
  SubagentOutcomeItemKind,
  SubagentOutcomeSeverity,
  SubagentStopReason,
  SubagentSupervisorStatus,
  SubagentTaskStatus,
} from "./subagent-supervisor.js";

export type SubagentHubTranscriptKindV1 =
  | "lifecycle"
  | "assistant"
  | "tool"
  | "message"
  | "outcome"
  | "worktree";

export interface SubagentHubTranscriptEntryV1 {
  id: string;
  seq: number;
  createdAt: string;
  eventType: string;
  kind: SubagentHubTranscriptKindV1;
  status?: string;
  messageKind?: SubagentMessageKind;
  text?: string;
  textSha256?: string;
  textBytes?: number;
  contentRedacted?: true;
  toolName?: string;
  isError?: boolean;
}

export interface SubagentHubMailboxV1 {
  acceptedCount: number;
  deliveredCount: number;
  pendingCount: number;
  lastAcceptedAt?: string;
  lastDeliveredAt?: string;
}

export interface SubagentHubLineageV1 {
  parentTaskId?: string;
  childTaskIds: string[];
}

export interface SubagentHubOutcomeV1 {
  contentSha256: string;
  summary: string;
  itemCount: number;
  evidenceCount: number;
  unknownCount: number;
  blockerCount: number;
  warningCount: number;
  items: Array<{
    kind: SubagentOutcomeItemKind;
    severity: SubagentOutcomeSeverity;
    title: string;
    evidenceCount: number;
  }>;
}

export interface SubagentHubTypedOutputV1 {
  schemaSha256: string;
  value: JsonValue;
}

export type SubagentHubWorktreeStateV1 =
  | "none"
  | "isolated"
  | "preview_ready"
  | "applied"
  | "rolled_back"
  | "indeterminate";

export interface SubagentHubWorktreeV1 {
  state: SubagentHubWorktreeStateV1;
  writeScopeCount?: number;
  changedFileCount?: number;
  addedFileCount?: number;
  modifiedFileCount?: number;
  deletedFileCount?: number;
  renamedFileCount?: number;
  applyStatus?: "applied" | "rolled_back" | "indeterminate";
  postcondition?: "verified" | "drifted" | "indeterminate";
  diagnosticsStatus?: string;
  durable?: boolean;
  rollbackAttempted?: boolean;
  rollbackVerified?: boolean;
  changedFileSetSha256?: string;
  resultSha256?: string;
}

export type SubagentHubControlUnavailableReasonV1 =
  | "execution_unavailable"
  | "task_not_active"
  | "task_not_terminal"
  | "parent_run_not_running"
  | "delegation_budget_exhausted"
  | "role_disabled"
  | "coder_write_scope_unavailable";

export interface SubagentHubControlAvailabilityV1 {
  steer: boolean;
  cancel: boolean;
  revive: boolean;
  unavailableReason?: SubagentHubControlUnavailableReasonV1;
}

export interface SubagentHubTaskV1 {
  taskId: string;
  runId: string;
  role: SubagentRole;
  description: string;
  status: SubagentSupervisorStatus;
  taskStatus: SubagentTaskStatus;
  model: ModelRef;
  routePlanId?: string;
  stepCount: number;
  turnCount: number;
  usage: Usage;
  revision: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  stopReason?: SubagentStopReason;
  mailbox: SubagentHubMailboxV1;
  lineage: SubagentHubLineageV1;
  transcript: SubagentHubTranscriptEntryV1[];
  typedOutput?: SubagentHubTypedOutputV1;
  outcome?: SubagentHubOutcomeV1;
  worktree: SubagentHubWorktreeV1;
  control: SubagentHubControlAvailabilityV1;
}

export interface SubagentHubProjectionV1 {
  kind: "napier.subagent-hub-projection";
  schemaVersion: 1;
  threadId: string;
  taskCount: number;
  selectedTaskCount: number;
  activeTaskCount: number;
  terminalTaskCount: number;
  orphanedTaskCount: number;
  omittedTaskCount: number;
  eventWatermark: number;
  tasks: SubagentHubTaskV1[];
}

export interface SteerSubagentHubTaskRequestV1 {
  kind: "napier.subagent-hub-steer-request";
  schemaVersion: 1;
  expectedTaskRevision: number;
  messageKind: SubagentMessageKind;
  text: string;
}

export interface CancelSubagentHubTaskRequestV1 {
  kind: "napier.subagent-hub-cancel-request";
  schemaVersion: 1;
  expectedTaskRevision: number;
  reason: string;
}

export interface ReviveSubagentHubTaskRequestV1 {
  kind: "napier.subagent-hub-revive-request";
  schemaVersion: 1;
  expectedTaskRevision: number;
}

export interface SubagentHubActionResultV1 {
  kind: "napier.subagent-hub-action-result";
  schemaVersion: 1;
  action: "steer" | "cancel" | "revive";
  sourceTaskId: string;
  sourceTaskRevision: number;
  taskId: string;
  executionId?: string;
  messageId?: string;
  acceptedAt: string;
}

export interface SubagentHubActionResponseV1 {
  kind: "napier.subagent-hub-action-response";
  schemaVersion: 1;
  result: SubagentHubActionResultV1;
  hub: SubagentHubProjectionV1;
}
