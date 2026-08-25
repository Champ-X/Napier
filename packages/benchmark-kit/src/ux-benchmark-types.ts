import type { ModelRef, RunEvent, RunStatus, Usage } from "@napier/contracts";

export interface UxBenchmarkCase {
  kind: "napier.ux-benchmark-case";
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  promptPath: string;
  expectedPath: string;
  timeoutMs: number;
  maxFirstEventMs: number;
  maxDurationMs: number;
  promptSha256: string;
  expectedSha256: string;
  contentSha256: string;
}

export interface UxBenchmarkExpected {
  assistantText: string;
  manualCommandCount: 1;
  credentialReferenceCount: 1;
  threadCountAfter: 2;
}

export type UxBenchmarkDiagnostic =
  | "cli_exit_nonzero"
  | "run_not_completed"
  | "output_mismatch"
  | "manual_command_count_mismatch"
  | "first_event_budget_exceeded"
  | "duration_budget_exceeded"
  | "credential_reference_count_mismatch"
  | "credential_provider_mismatch"
  | "credential_locator_mismatch"
  | "credential_unavailable"
  | "thread_count_mismatch"
  | "replay_invalid"
  | "credential_leaked"
  | "credential_persisted";

export interface UxBenchmarkEvaluation {
  kind: "napier.ux-benchmark-evaluation";
  schemaVersion: 1;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  runStatus: RunStatus;
  criteriaSha256: string;
  cliExitCode: number;
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  outputMatch: boolean;
  manualCommandCount: number;
  firstEventMs: number;
  maxFirstEventMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  threadCountAfter: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  diagnostics: UxBenchmarkDiagnostic[];
  contentSha256: string;
}

export interface UxBenchmarkResult {
  kind: "napier.ux-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: UxBenchmarkEvaluation["status"];
  model: ModelRef;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cliVersion: string;
  };
  run: {
    threadId: string;
    runId: string;
    status: RunStatus;
    durationMs: number;
    usage: Usage;
  };
  evaluation: UxBenchmarkEvaluation;
  ledger: {
    eventId: string;
    eventSeq: number;
    eventSha256: string;
    eventStreamSha256: string;
    bundleFileName: string;
    bundleSha256: string;
    bundleBytes: number;
  };
  contentSha256: string;
}

export interface UxBenchmarkLedgerEventReceipt {
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

export interface UxBenchmarkLedgerBundle {
  kind: "napier.ux-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  model: ModelRef;
  environment: UxBenchmarkResult["environment"];
  run: UxBenchmarkResult["run"];
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  credentialVariableSha256: string;
  cliExitCode: number;
  manualCommandCount: number;
  firstEventMs: number;
  maxFirstEventMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  threadCountAfter: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  eventCount: number;
  retainedEventCount: number;
  omittedEventCount: number;
  eventTypeCounts: Array<{ type: string; count: number }>;
  eventTypeSetSha256: string;
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  eventReceipts: UxBenchmarkLedgerEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface UxBenchmarkArtifacts {
  result: UxBenchmarkResult;
  bundle: UxBenchmarkLedgerBundle;
  resultPath: string;
  ledgerPath: string;
}

export interface UxBenchmarkArtifactVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
  bundleSha256?: string;
}

export interface UxBenchmarkMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface UxBenchmarkSeries {
  kind: "napier.ux-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: UxBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  completionRate: number;
  passRate: number | null;
  metrics: {
    firstEventMs: UxBenchmarkMetricSummary;
    totalDurationMs: UxBenchmarkMetricSummary;
    costUsd: UxBenchmarkMetricSummary;
    inputTokens: UxBenchmarkMetricSummary;
    outputTokens: UxBenchmarkMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    status: UxBenchmarkEvaluation["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface UxBenchmarkSeriesArtifacts {
  series: UxBenchmarkSeries;
  seriesPath: string;
  trials: UxBenchmarkArtifacts[];
}

export interface UxBenchmarkSeriesVerification {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{ index: number; diagnostics: string[] }>;
}
