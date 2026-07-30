import type { ModelRef } from "@napier/contracts";

import type { CodingBenchmarkResult } from "./coding-benchmark-types.js";

export interface CodingBenchmarkMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface CodingBenchmarkSeriesMetrics {
  durationMs: CodingBenchmarkMetricSummary;
  costUsd: CodingBenchmarkMetricSummary;
  inputTokens: CodingBenchmarkMetricSummary;
  outputTokens: CodingBenchmarkMetricSummary;
  cacheReadTokens: CodingBenchmarkMetricSummary;
  cacheWriteTokens: CodingBenchmarkMetricSummary;
  toolStarted: CodingBenchmarkMetricSummary;
  toolCompleted: CodingBenchmarkMetricSummary;
  toolFailed: CodingBenchmarkMetricSummary;
  toolBlocked: CodingBenchmarkMetricSummary;
  repeatedToolCalls: CodingBenchmarkMetricSummary;
}

export interface CodingBenchmarkSeriesTrial {
  index: number;
  runId: string;
  status: "passed" | "failed" | "inconclusive";
  resultFileName: string;
  resultSha256: string;
  ledgerFileName: string;
  ledgerSha256: string;
}

export interface CodingBenchmarkSeries {
  kind: "napier.coding-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: CodingBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  scoredTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  completionRate: number;
  passRate: number | null;
  applyPatchCompletedTrialCount: number;
  metrics: CodingBenchmarkSeriesMetrics;
  trials: CodingBenchmarkSeriesTrial[];
  contentSha256: string;
}

export interface CodingBenchmarkSeriesTrialArtifact {
  resultFileName: string;
  result: unknown;
  bundle: unknown;
}

export interface CodingBenchmarkSeriesVerification {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{
    index: number;
    diagnostics: string[];
  }>;
}
