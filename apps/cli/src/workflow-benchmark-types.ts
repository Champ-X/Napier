import type {
  ExecutionPlanWorkflowResult,
  ModelRef,
  RunEvent,
  RunExecutionMode,
  RunStatus,
  Usage,
} from "@napier/contracts";

export interface WorkflowBenchmarkDocument {
  id: string;
  text: string;
}

export interface WorkflowBenchmarkInput {
  documents: WorkflowBenchmarkDocument[];
}

export interface WorkflowBenchmarkExpected {
  mapItems: Array<{ id: string; length: number }>;
  output: number;
}

interface WorkflowBenchmarkCaseBase {
  kind: "napier.workflow-benchmark-case";
  id: string;
  title: string;
  objective: string;
  inputPath: string;
  expectedPath: string;
  timeoutMs: number;
  inputSha256: string;
  expectedSha256: string;
  contentSha256: string;
}

export interface WorkflowBenchmarkCaseV1 extends WorkflowBenchmarkCaseBase {
  schemaVersion: 1;
}

export interface WorkflowBenchmarkCaseV2 extends WorkflowBenchmarkCaseBase {
  schemaVersion: 2;
  scenario: "sqlite_metric_map_reduce";
  setupSqlPath: string;
  setupSqlSha256: string;
  databasePath: string;
  requiredSqliteActions: Array<"schema" | "query" | "chart">;
}

export type WorkflowBenchmarkCase =
  | WorkflowBenchmarkCaseV1
  | WorkflowBenchmarkCaseV2;

export type WorkflowBenchmarkDiagnostic =
  | "workflow_not_completed"
  | "output_mismatch"
  | "map_output_mismatch"
  | "node_result_mismatch"
  | "map_run_mismatch"
  | "map_event_mismatch"
  | "reduce_event_mismatch"
  | "reduce_executed_model_or_tool"
  | "sqlite_action_mismatch"
  | "database_changed"
  | "replay_invalid"
  | "credential_leaked";

export interface WorkflowBenchmarkEvaluation {
  kind: "napier.workflow-benchmark-evaluation";
  schemaVersion: 1 | 2;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  workflowStatus: ExecutionPlanWorkflowResult["status"];
  criteriaSha256: string;
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  expectedMapOutputSha256: string;
  actualMapOutputSha256?: string;
  outputMatch: boolean;
  mapOutputMatch: boolean;
  expectedNodeResultCount: number;
  completedNodeResultCount: number;
  expectedMapItemCount: number;
  completedMapRunCount: number;
  mapCompletedEventCount: number;
  reduceCompletedEventCount: number;
  reduceModelOrToolEventCount: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  sqliteSchemaCompletedCount?: number;
  sqliteQueryCompletedCount?: number;
  sqliteChartCompletedCount?: number;
  sqliteProtocolValid?: boolean;
  databaseUnchanged?: boolean;
  diagnostics: WorkflowBenchmarkDiagnostic[];
  contentSha256: string;
}

export interface WorkflowBenchmarkResult {
  kind: "napier.workflow-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  model: ModelRef;
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    cliVersion: string;
  };
  run: {
    threadId: string;
    planId: string;
    status: ExecutionPlanWorkflowResult["status"];
    durationMs: number;
    runCount: number;
    completedRunCount: number;
    usage: Usage;
  };
  workflow: {
    manifestSha256: string;
    blueprintSha256: string;
    resultSha256: string;
    outputSha256?: string;
    nodeResultCount: number;
    completedNodeResultCount: number;
  };
  evaluation: WorkflowBenchmarkEvaluation;
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

export interface WorkflowBenchmarkLedgerEventReceipt {
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

export interface WorkflowBenchmarkLedgerBundle {
  kind: "napier.workflow-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  workflow: WorkflowBenchmarkResult["workflow"] & {
    planId: string;
    status: ExecutionPlanWorkflowResult["status"];
    mapOutputSha256?: string;
    mapRunIds: string[];
    reduceRunId: string;
    sqliteActionEvents?: RunEvent[];
    databaseBeforeSha256?: string;
    databaseAfterSha256?: string;
  };
  runs: Array<{
    id: string;
    status: RunStatus;
    parentRunId?: string;
    executionMode?: RunExecutionMode;
    configurationSha256?: string;
    durationMs: number;
    usage: Usage;
  }>;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  eventCount: number;
  retainedEventCount: number;
  omittedEventCount: number;
  eventTypeCounts: Array<{ type: string; count: number }>;
  eventTypeSetSha256: string;
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  eventReceipts: WorkflowBenchmarkLedgerEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface WorkflowBenchmarkArtifacts {
  result: WorkflowBenchmarkResult;
  bundle: WorkflowBenchmarkLedgerBundle;
  resultPath: string;
  ledgerPath: string;
}

export interface WorkflowBenchmarkArtifactVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
  bundleSha256?: string;
}

export interface WorkflowBenchmarkMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface WorkflowBenchmarkSeries {
  kind: "napier.workflow-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: WorkflowBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  scoredTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  completionRate: number;
  passRate: number | null;
  metrics: {
    durationMs: WorkflowBenchmarkMetricSummary;
    costUsd: WorkflowBenchmarkMetricSummary;
    inputTokens: WorkflowBenchmarkMetricSummary;
    outputTokens: WorkflowBenchmarkMetricSummary;
    runCount: WorkflowBenchmarkMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    status: WorkflowBenchmarkResult["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface WorkflowBenchmarkSeriesVerification {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{
    index: number;
    diagnostics: string[];
  }>;
}
