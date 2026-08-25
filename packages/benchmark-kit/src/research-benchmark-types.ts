import type { ModelRef, RunEvent, RunStatus, Usage } from "@napier/contracts";
import type { BrowserPageSourceCapture } from "@napier/runtime/browser";

export interface ResearchBenchmarkSourceFixture {
  id: string;
  authority: "primary" | "secondary";
  capture: BrowserPageSourceCapture;
}

export interface ResearchBenchmarkSources {
  sources: ResearchBenchmarkSourceFixture[];
}

export interface ResearchBenchmarkExpected {
  claims: string[];
  requiredCitations: Array<{
    claimIndex: number;
    sourceId: string;
    startLine: number;
    endLine: number;
  }>;
  requiredCaptureCount: number;
  requiredCitationCount: number;
  requiredPrimarySourceCount: number;
  requiredSecondarySourceCount: number;
  contradictionRequired: boolean;
}

export interface ResearchBenchmarkCase {
  kind: "napier.research-benchmark-case";
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  promptPath: string;
  sourcesPath: string;
  expectedPath: string;
  reportPath: string;
  timeoutMs: number;
  promptSha256: string;
  sourcesSha256: string;
  expectedSha256: string;
  contentSha256: string;
}

export type ResearchBenchmarkDiagnostic =
  | "run_not_completed"
  | "report_missing"
  | "claims_mismatch"
  | "source_capture_mismatch"
  | "citation_count_mismatch"
  | "citation_evidence_mismatch"
  | "primary_source_coverage_mismatch"
  | "secondary_source_coverage_mismatch"
  | "contradiction_missing"
  | "report_not_verified"
  | "replay_invalid"
  | "credential_leaked";

export interface ResearchBenchmarkEvaluation {
  kind: "napier.research-benchmark-evaluation";
  schemaVersion: 1;
  caseId: string;
  caseSha256: string;
  status: "passed" | "failed" | "inconclusive";
  runStatus: RunStatus;
  criteriaSha256: string;
  expectedClaimsSha256: string;
  actualClaimsSha256?: string;
  claimsMatch: boolean;
  expectedCitationEvidenceSha256: string;
  actualCitationEvidenceSha256: string;
  citationEvidenceMatch: boolean;
  expectedSourceSetSha256: string;
  actualSourceSetSha256: string;
  sourceCaptureMatch: boolean;
  captureCount: number;
  citationCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  contradictionFound: boolean;
  reportVerified: boolean;
  reportFileSha256?: string;
  reportFileBytes: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  diagnostics: ResearchBenchmarkDiagnostic[];
  contentSha256: string;
}

export interface ResearchBenchmarkResult {
  kind: "napier.research-benchmark-result";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  status: ResearchBenchmarkEvaluation["status"];
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
  report: {
    pathSha256: string;
    fileSha256?: string;
    fileBytes: number;
  };
  evaluation: ResearchBenchmarkEvaluation;
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

export interface ResearchBenchmarkLedgerEventReceipt {
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

export interface ResearchBenchmarkLedgerBundle {
  kind: "napier.research-benchmark-ledger";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  run: ResearchBenchmarkResult["run"];
  expectedClaimsSha256: string;
  actualClaimsSha256?: string;
  contradictionClaimSha256: string;
  expectedCitationEvidenceSha256: string;
  expectedSourceSetSha256: string;
  sourceAuthorities: Array<{
    sourceContentSha256: string;
    authority: "primary" | "secondary";
  }>;
  report: ResearchBenchmarkResult["report"];
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  researchEvents: RunEvent[];
  eventCount: number;
  retainedEventCount: number;
  omittedEventCount: number;
  eventTypeCounts: Array<{ type: string; count: number }>;
  eventTypeSetSha256: string;
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  eventReceipts: ResearchBenchmarkLedgerEventReceipt[];
  receiptSetSha256: string;
  contentSha256: string;
}

export interface ResearchBenchmarkArtifacts {
  result: ResearchBenchmarkResult;
  bundle: ResearchBenchmarkLedgerBundle;
  resultPath: string;
  ledgerPath: string;
}

export interface ResearchBenchmarkArtifactVerification {
  valid: boolean;
  diagnostics: string[];
  resultSha256: string;
  bundleSha256?: string;
}

export interface ResearchBenchmarkMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface ResearchBenchmarkSeries {
  kind: "napier.research-benchmark-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: ResearchBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  completionRate: number;
  passRate: number | null;
  metrics: {
    durationMs: ResearchBenchmarkMetricSummary;
    costUsd: ResearchBenchmarkMetricSummary;
    inputTokens: ResearchBenchmarkMetricSummary;
    outputTokens: ResearchBenchmarkMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    status: ResearchBenchmarkEvaluation["status"];
    resultFileName: string;
    resultSha256: string;
    ledgerFileName: string;
    ledgerSha256: string;
  }>;
  contentSha256: string;
}

export interface ResearchBenchmarkSeriesArtifacts {
  series: ResearchBenchmarkSeries;
  seriesPath: string;
  trials: ResearchBenchmarkArtifacts[];
}

export interface ResearchBenchmarkSeriesVerification {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{
    index: number;
    diagnostics: string[];
  }>;
}
