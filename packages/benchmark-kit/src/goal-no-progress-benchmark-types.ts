import type { ModelRef, RunEvent, Usage } from "@napier/contracts";

export interface GoalNoProgressBenchmarkCase {
  kind: "napier.goal-no-progress-benchmark-case";
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  prompt: string;
  systemPrompt: string;
  expectedAssistantText: string;
  expectedContinuationCount: number;
  expectedEvaluationCount: number;
  expectedNoProgressCount: number;
  expectedPrimaryResponseCount: number;
  expectedModelResponseCount: number;
  timeoutMs: number;
  contentSha256: string;
}

export interface GoalNoProgressBenchmarkEvaluation {
  kind: "napier.goal-no-progress-benchmark-evaluation";
  schemaVersion: 1;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  runStatus: string;
  goalStatus: string;
  goalBlocker: string;
  continuationCount: number;
  noProgressCount: number;
  maxNoProgressContinuations: number;
  goalEvaluationCount: number;
  continuationStartedCount: number;
  primaryResponseCount: number;
  repeatedResponseCount: number;
  modelResponseCount: number;
  modelResponseErrorCount: number;
  modelResponseUsageSampleCount: number;
  postBlockContinuationCount: number;
  goalRecovered: boolean;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  diagnostics: string[];
  contentSha256: string;
}

export interface GoalNoProgressBenchmarkResult {
  kind: "napier.goal-no-progress-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: GoalNoProgressBenchmarkEvaluation["status"];
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
    status: string;
    durationMs: number;
    usage: Usage;
  };
  evaluation: GoalNoProgressBenchmarkEvaluation;
  ledger: {
    bundleFileName: string;
    bundleSha256: string;
    bundleBytes: number;
  };
  contentSha256: string;
}

export interface GoalNoProgressEventReceipt {
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

export interface GoalNoProgressBenchmarkLedger {
  kind: "napier.goal-no-progress-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  goal: {
    objectiveSha256: string;
    objectiveBytes: number;
    status: string;
    blocker: string;
    continuationCount: number;
    noProgressCount: number;
    maxNoProgressContinuations: number;
    lastEvidenceHash?: string;
    lastEvaluatedRunId?: string;
  };
  goalEvents: RunEvent[];
  assistantEvents: RunEvent[];
  modelResponseObservationEvent: RunEvent;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  eventCount: number;
  sourceReplaySha256: string;
  eventReceipts: GoalNoProgressEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface GoalNoProgressBenchmarkArtifacts {
  result: GoalNoProgressBenchmarkResult;
  bundle: GoalNoProgressBenchmarkLedger;
  resultPath: string;
  ledgerPath: string;
}

export interface GoalNoProgressMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface GoalNoProgressBenchmarkSeries {
  kind: "napier.goal-no-progress-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: GoalNoProgressBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  successRate: number;
  passRate: number | null;
  metrics: {
    durationMs: GoalNoProgressMetricSummary;
    costUsd: GoalNoProgressMetricSummary;
    inputTokens: GoalNoProgressMetricSummary;
    outputTokens: GoalNoProgressMetricSummary;
    modelResponseCount: GoalNoProgressMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    status: GoalNoProgressBenchmarkResult["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface GoalNoProgressBenchmarkSeriesArtifacts {
  series: GoalNoProgressBenchmarkSeries;
  seriesPath: string;
  trials: GoalNoProgressBenchmarkArtifacts[];
}
