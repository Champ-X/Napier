export type WorkspaceProcessStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "output_capped"
  | "cancelled"
  | "interrupted";

export type WorkspaceProcessDeltaStatus =
  | "unchanged"
  | "changed"
  | "indeterminate";

export type WorkspaceProcessAccess = "read_only" | "scoped_write";
export type WorkspaceProcessNetworkAccess =
  | "denied"
  | "outbound_denied_loopback_service";
export type WorkspaceProcessWriteScopeStatus =
  | "within_scope"
  | "outside_scope"
  | "indeterminate";
export type WorkspaceProcessStdinMode = "closed" | "interactive";
export type WorkspaceProcessIoMode = "pipe" | "pty";
export type WorkspaceProcessFailureRecovery = "restore_scopes";
export type WorkspaceProcessCompensationStatus =
  | "pending"
  | "not_needed"
  | "restored"
  | "reverted"
  | "indeterminate"
  | "unavailable";

export interface WorkspaceProcessLocalService {
  protocol: "http";
  containerPort: number;
  host: "127.0.0.1";
  hostPort: number;
  url: string;
  healthPathSha256: string;
  identitySha256: string;
  status: "ready" | "closed";
  readyAt: string;
}

export interface WorkspaceProcessWritePreview {
  kind: "napier.workspace-process-write-preview";
  schemaVersion: 1 | 2;
  id: string;
  threadId: string;
  runId: string;
  runtime: "node" | "python" | "shell";
  sandbox: string;
  argumentCount: number;
  commandSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  cwdPathSha256: string;
  timeoutMs: number;
  ioMode: WorkspaceProcessIoMode;
  terminalType?: "xterm-256color";
  terminalColumns?: number;
  terminalRows?: number;
  writeScopeCount: number;
  writeScopeSetSha256: string;
  workspaceBeforeSha256: string;
  workspaceBeforeFileCount: number;
  workspaceBeforeBytes: number;
  failureRecovery?: WorkspaceProcessFailureRecovery;
  createdAt: string;
  expiresAt: string;
  contentSha256: string;
}

export interface WorkspaceProcessSession {
  kind: "napier.workspace-process-session";
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  id: string;
  threadId: string;
  runId: string;
  runtime: "node" | "python" | "shell";
  status: WorkspaceProcessStatus;
  sandbox: string;
  workspaceAccess: WorkspaceProcessAccess;
  networkAccess: WorkspaceProcessNetworkAccess;
  localService?: WorkspaceProcessLocalService;
  argumentCount: number;
  commandSha256: string;
  executableSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  cwdPathSha256: string;
  timeoutMs: number;
  outputLimitChars: number;
  ioMode?: WorkspaceProcessIoMode;
  stdinMode?: WorkspaceProcessStdinMode;
  stdinOpen?: boolean;
  stdinWriteCount?: number;
  stdinBytes?: number;
  stdinSha256?: string;
  terminalType?: "xterm-256color";
  terminalColumns?: number;
  terminalRows?: number;
  terminalResizeCount?: number;
  workspaceBeforeSha256?: string;
  workspaceBeforeTruncated?: boolean;
  workspaceAfterSha256?: string;
  workspaceAfterTruncated?: boolean;
  workspaceDeltaStatus?: WorkspaceProcessDeltaStatus;
  workspaceChangedFileCount?: number;
  workspaceChangedPathSetSha256?: string;
  writePreviewSha256?: string;
  writeScopeCount?: number;
  writeScopeSetSha256?: string;
  workspaceWriteScopeStatus?: WorkspaceProcessWriteScopeStatus;
  recoverySnapshotSha256?: string;
  recoveryScopeCount?: number;
  recoveryFileCount?: number;
  recoveryDirectoryCount?: number;
  recoveryBytes?: number;
  failureRecovery?: WorkspaceProcessFailureRecovery;
  workspaceCompensationStatus?: WorkspaceProcessCompensationStatus;
  workspaceRollbackAvailable?: boolean;
  workspaceDeltaAvailable?: boolean;
  startedAt: string;
  settledAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  stdoutChars: number;
  stderrChars: number;
  stdoutSha256?: string;
  stderrSha256?: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  nextCursor: number;
  outputAvailable: boolean;
  interruptionReason?: string;
  contentSha256: string;
}

export interface WorkspaceProcessRollbackPreview {
  kind: "napier.workspace-process-rollback-preview";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  sessionSha256: string;
  recoverySnapshotSha256: string;
  expectedWorkspaceSha256: string;
  scopeCount: number;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  createdAt: string;
  expiresAt: string;
  contentSha256: string;
}

export interface WorkspaceProcessRollbackAttempt {
  kind: "napier.workspace-process-rollback-attempt";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  initiatedBy: "operator" | "automatic_compensation";
  previewSha256: string;
  recoverySnapshotSha256: string;
  expectedWorkspaceSha256: string;
  scopeCount: number;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  attemptedAt: string;
  contentSha256: string;
}

export interface WorkspaceProcessRollbackResult {
  kind: "napier.workspace-process-rollback";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  initiatedBy: "operator" | "automatic_compensation";
  attemptSha256: string;
  status: "restored" | "reverted" | "indeterminate";
  recoverySnapshotSha256: string;
  expectedWorkspaceSha256: string;
  observedWorkspaceSha256: string;
  scopeCount: number;
  restoredScopeCount: number;
  fileCount: number;
  directoryCount: number;
  bytes: number;
  rollbackAttempted: boolean;
  rollbackVerified: boolean;
  durable: boolean;
  cancellationObserved: boolean;
  appliedAt: string;
  errorSha256?: string;
  contentSha256: string;
}

export interface WorkspaceProcessResizeReceipt {
  kind: "napier.workspace-process-resize";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  initiatedBy: "agent" | "operator";
  sequence: number;
  columns: number;
  rows: number;
  resizedAt: string;
  sessionSha256: string;
  contentSha256: string;
}

export interface WorkspaceProcessInputReceipt {
  kind: "napier.workspace-process-input";
  schemaVersion: 1;
  id: string;
  threadId: string;
  runId: string;
  processId: string;
  initiatedBy: "agent" | "operator";
  sequence: number;
  inputBytes: number;
  inputSha256: string;
  totalInputBytes: number;
  cumulativeInputSha256: string;
  stdinClosed: boolean;
  writtenAt: string;
  sessionSha256: string;
  contentSha256: string;
}

export interface WorkspaceProcessOutputChunk {
  cursor: number;
  stream: "stdout" | "stderr";
  text: string;
}

export interface WorkspaceProcessOutput {
  kind: "napier.workspace-process-output";
  schemaVersion: 1;
  processId: string;
  status: WorkspaceProcessStatus;
  afterCursor: number;
  nextCursor: number;
  hasMore: boolean;
  outputAvailable: boolean;
  chunks: WorkspaceProcessOutputChunk[];
}

export interface WorkspaceProcessDeltaEntry {
  kind: "added" | "modified" | "removed";
  path: string;
  entryKind?: "file" | "directory" | "symlink";
  beforeSha256?: string;
  afterSha256?: string;
  beforeSizeBytes?: number;
  afterSizeBytes?: number;
}

export interface WorkspaceProcessDelta {
  kind: "napier.workspace-process-delta";
  schemaVersion: 1;
  processId: string;
  status?: WorkspaceProcessDeltaStatus;
  writeScopeStatus?: WorkspaceProcessWriteScopeStatus;
  available: boolean;
  entriesTruncated: boolean;
  entries: WorkspaceProcessDeltaEntry[];
}
