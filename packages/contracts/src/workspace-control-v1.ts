import type { ModelRef, RunEvent } from "./execution-core.js";
import type { RunMetrics, RunRecord } from "./execution-runs.js";
import type { SubagentTask } from "./subagent-supervisor.js";

export type WorkspaceFileMutationOperation = "create_directory" | "move" | "trash" | "restore";

export type WorkspaceFileEntryKind = "file" | "directory";

export interface WorkspaceFileMutationEvidence {
  kind: "napier.workspace-file-mutation";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  operation: WorkspaceFileMutationOperation;
  initiatedBy: "agent" | "operator";
  entryKind?: WorkspaceFileEntryKind;
  sourcePathSha256?: string;
  destinationPathSha256?: string;
  beforeSha256?: string;
  afterSha256?: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  createdDirectoryCount?: number;
  trashId?: string;
  reversible: boolean;
  postcondition: "verified" | "drifted" | "indeterminate";
  appliedAt: string;
  contentSha256: string;
}

export interface WorkspaceTrashItem {
  kind: "napier.workspace-trash-item";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  originalPath: string;
  originalPathSha256: string;
  entryKind: WorkspaceFileEntryKind;
  snapshotSha256: string;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  trashedAt: string;
  contentSha256: string;
}

export interface WorkspaceTrashList {
  kind: "napier.workspace-trash-list";
  schemaVersion: 1;
  threadId: string;
  items: WorkspaceTrashItem[];
}

export interface WorkspaceTrashRestoreResult {
  kind: "napier.workspace-trash-restore";
  schemaVersion: 1;
  trashId: string;
  restoredPath: string;
  evidence: WorkspaceFileMutationEvidence;
}

export interface RequestOperatorDecisionInput {
  header: string;
  question: string;
  options: Array<{
    label: string;
    description: string;
  }>;
  multiSelect: boolean;
}

export type AgentMilestonePhase = "planning" | "execution" | "verification" | "delivery";

export interface RecordAgentMilestoneInput {
  phase: AgentMilestonePhase;
  title: string;
  summary: string;
  completedItems: string[];
  openLoops: string[];
}

export interface AgentMilestoneEvidenceRange {
  fromSeq: number;
  toSeq: number;
  eventCount: number;
  eventStreamSha256: string;
}

export interface AgentMilestone {
  kind: "napier.agent-milestone";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  sequence: number;
  phase: AgentMilestonePhase;
  title: string;
  summary: string;
  completedItems: string[];
  openLoops: string[];
  summarySha256: string;
  completedItemSetSha256: string;
  openLoopSetSha256: string;
  evidence: AgentMilestoneEvidenceRange;
  predecessorMilestoneId?: string;
  predecessorEventSeq?: number;
  recordedAt: string;
  eventSeq: number;
  contentSha256: string;
}

export interface RunLeaseHandle {
  run: RunRecord;
  token: string;
}

export type ScheduleStatus = "active" | "paused";

export type ScheduleTrigger =
  | {
      type: "interval";
      everyMs: number;
      anchorAt?: string;
    }
  | {
      type: "cron";
      expression: string;
      timezone: "UTC";
    };

export interface AutomationSchedule {
  id: string;
  name: string;
  threadId: string;
  prompt: string;
  model?: ModelRef;
  trigger: ScheduleTrigger;
  status: ScheduleStatus;
  overlapPolicy: "skip";
  misfirePolicy: "run_once" | "skip";
  nextRunAt: string;
  lastScheduledFor?: string;
  lastRunAt?: string;
  lastRunId?: string;
  lastError?: string;
  claim?: {
    ownerId: string;
    scheduledFor: string;
    acquiredAt: string;
    expiresAt: string;
    revision: number;
  };
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutomationScheduleRequest {
  name: string;
  threadId: string;
  prompt: string;
  model?: ModelRef;
  trigger: ScheduleTrigger;
  status?: ScheduleStatus;
  misfirePolicy?: AutomationSchedule["misfirePolicy"];
}

export interface UpdateAutomationScheduleRequest {
  name?: string;
  prompt?: string;
  model?: ModelRef;
  trigger?: ScheduleTrigger;
  status?: ScheduleStatus;
  misfirePolicy?: AutomationSchedule["misfirePolicy"];
}

export interface ScheduleClaim {
  schedule: AutomationSchedule;
  token: string;
  scheduledFor: string;
}

export interface ContextCheckpointSnapshot {
  schemaVersion: 1;
  checkpointId: string;
  parentCheckpointId?: string;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceEventCount: number;
  sourceSha256: string;
  summarySha256: string;
  summary: string;
  decisions: string[];
  openLoops: string[];
  artifacts: string[];
}

export type ContextCheckpointCalibrationState = "verified" | "drifted" | "malformed";

export interface ContextCheckpointCalibrationSample {
  eventId: string;
  runId?: string;
  seq: number;
  state: ContextCheckpointCalibrationState;
  reason: string;
  checkpointId?: string;
  parentCheckpointId?: string;
  fromSeq?: number;
  toSeq?: number;
  retainedFromSeq?: number;
  sourceEventCount?: number;
  coveredMessageCount: number;
  sourceCharacterCount: number;
  summaryCharacterCount: number;
  compressionRatio: number;
  decisionCount: number;
  openLoopCount: number;
  artifactCount: number;
  sourceSha256?: string;
  summarySha256?: string;
  sampleSha256: string;
}

export interface ContextCompactionFailureSample {
  eventId: string;
  runId?: string;
  seq: number;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceEventCount: number;
  fallbackMessageCount: number;
  omittedMessageCount: number;
  messageSha256: string;
  failureSha256: string;
}

export interface ContextCheckpointCalibrationReport {
  kind: "napier.context-checkpoint-calibration";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  threadId: string;
  eventStreamSha256: string;
  messageEventCount: number;
  checkpointCount: number;
  verifiedCheckpointCount: number;
  driftedCheckpointCount: number;
  malformedCheckpointCount: number;
  failureCount: number;
  coveredMessageCount: number;
  coverageRate: number;
  sourceCharacterCount: number;
  summaryCharacterCount: number;
  compressionRatio: number;
  fallbackOmittedMessageCount: number;
  latestValidCheckpointId?: string;
  latestValidCheckpointSampleSha256?: string;
  samples: ContextCheckpointCalibrationSample[];
  failures: ContextCompactionFailureSample[];
  contentSha256: string;
}

export interface RunReplaySnapshot {
  schemaVersion: 1;
  generatedAt: string;
  threadId: string;
  run: RunRecord;
  metrics: RunMetrics;
  events: RunEvent[];
  subagents: SubagentTask[];
  eventStreamSha256: string;
  configurationSha256?: string;
  contentSha256: string;
}

export interface VerifyRunReplaySnapshotRequest {
  snapshot: RunReplaySnapshot;
}

export type RunReplaySnapshotVerificationStatus = "valid" | "invalid";

export interface RunReplaySnapshotVerification {
  status: RunReplaySnapshotVerificationStatus;
  diagnostics: string[];
  eventCount: number;
  subagentCount: number;
  modelContextEnvelopeCount: number;
  embeddedModelContextEnvelopeCount: number;
  threadId?: string;
  runId?: string;
  contentSha256?: string;
  eventStreamSha256?: string;
  configurationSha256?: string;
  assistantTextSha256?: string;
}
