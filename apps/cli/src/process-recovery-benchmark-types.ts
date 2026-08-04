import type {
  RunEvent,
  WorkspaceProcessCompensationStatus,
  WorkspaceProcessDeltaStatus,
  WorkspaceProcessStatus,
  WorkspaceProcessWriteScopeStatus,
} from "@napier/contracts";

export type ProcessRecoverySandboxBoundary = "platform" | "trusted_outer_test";

export interface ProcessRecoveryBenchmarkCase {
  kind: "napier.process-recovery-benchmark-case";
  schemaVersion: 1;
  id: string;
  title: string;
  writeScope: string;
  targetPath: string;
  initialText: string;
  mutatedText: string;
  expectedProcessStatus: "failed";
  expectedCompensationStatus: "restored";
  expectedExitCode: number;
  expectedProcessEventTypes: string[];
  timeoutMs: number;
  contentSha256: string;
}

export interface ProcessRecoveryBenchmarkEvaluation {
  kind: "napier.process-recovery-benchmark-evaluation";
  schemaVersion: 1;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  sandboxId: string;
  sandboxBoundary: ProcessRecoverySandboxBoundary;
  processSchemaVersion: number;
  processStatus: string;
  processExitCode: number | null;
  workspaceDeltaStatus: string;
  workspaceWriteScopeStatus: string;
  workspaceCompensationStatus: string;
  workspaceRollbackAvailable: boolean;
  targetRestored: boolean;
  recoverySnapshotPresent: boolean;
  processEventCount: number;
  processEventOrderValid: boolean;
  recoveredAfterReopen: boolean;
  replayValid: boolean;
  diagnostics: string[];
  contentSha256: string;
}

export interface ProcessRecoveryEventReceipt {
  id: string;
  seq: number;
  runId: string;
  type: string;
  category: RunEvent["category"];
  visibility: RunEvent["visibility"];
  createdAt: string;
  payloadSha256: string;
  previousReceiptSha256: string;
  receiptSha256: string;
}

export interface ProcessRecoveryBenchmarkLedger {
  kind: "napier.process-recovery-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  processId: string;
  preview: {
    schemaVersion: number;
    sandbox: string;
    commandSha256: string;
    executableSha256: string;
    environmentSha256: string;
    resourceLimitsSha256: string;
    writeScopeCount: number;
    writeScopeSetSha256: string;
    workspaceBeforeSha256: string;
    workspaceBeforeFileCount: number;
    workspaceBeforeBytes: number;
    failureRecovery: string;
    contentSha256: string;
  };
  process: {
    schemaVersion: number;
    sandbox: string;
    status: WorkspaceProcessStatus;
    exitCode: number | null;
    workspaceDeltaStatus?: WorkspaceProcessDeltaStatus;
    workspaceWriteScopeStatus?: WorkspaceProcessWriteScopeStatus;
    workspaceCompensationStatus?: WorkspaceProcessCompensationStatus;
    workspaceRollbackAvailable?: boolean;
    writePreviewSha256?: string;
    writeScopeCount?: number;
    writeScopeSetSha256?: string;
    recoverySnapshotSha256?: string;
    recoveryScopeCount?: number;
    recoveryFileCount?: number;
    recoveryDirectoryCount?: number;
    recoveryBytes?: number;
    contentSha256: string;
  };
  target: {
    initialSha256: string;
    mutatedSha256: string;
    finalSha256: string;
    restored: boolean;
  };
  processEvents: RunEvent[];
  evaluationEvent: RunEvent;
  eventCount: number;
  sourceReplaySha256: string;
  eventReceipts: ProcessRecoveryEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface ProcessRecoveryBenchmarkResult {
  kind: "napier.process-recovery-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: ProcessRecoveryBenchmarkEvaluation["status"];
  executor: {
    kind: "napier";
    capability: "workspace_process";
    sandboxId: string;
    sandboxBoundary: ProcessRecoverySandboxBoundary;
  };
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cliVersion: string;
  };
  run: {
    threadId: string;
    runId: string;
    processId: string;
    durationMs: number;
  };
  evaluation: ProcessRecoveryBenchmarkEvaluation;
  ledger: {
    bundleFileName: string;
    bundleSha256: string;
    bundleBytes: number;
  };
  contentSha256: string;
}

export interface ProcessRecoveryBenchmarkArtifacts {
  result: ProcessRecoveryBenchmarkResult;
  bundle: ProcessRecoveryBenchmarkLedger;
  resultPath: string;
  ledgerPath: string;
}

export interface ProcessRecoveryMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface ProcessRecoveryBenchmarkSeries {
  kind: "napier.process-recovery-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  executor: ProcessRecoveryBenchmarkResult["executor"];
  environment: ProcessRecoveryBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  successRate: number;
  passRate: number | null;
  metrics: {
    durationMs: ProcessRecoveryMetricSummary;
    processEventCount: ProcessRecoveryMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    processId: string;
    status: ProcessRecoveryBenchmarkResult["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface ProcessRecoveryBenchmarkSeriesArtifacts {
  series: ProcessRecoveryBenchmarkSeries;
  seriesPath: string;
  trials: ProcessRecoveryBenchmarkArtifacts[];
}
