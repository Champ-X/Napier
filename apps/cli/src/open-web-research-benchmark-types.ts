import type { ModelRef, RunStatus, Usage } from "@napier/contracts";

export interface OpenWebResearchBenchmarkExpected {
  claims: string[];
  expectedUrls: Array<{
    url: string;
    sourceKind: "web_fetch" | "browser";
    format?: "html" | "markdown" | "json" | "text" | "pdf";
  }>;
  citations: Array<{
    claim: string;
    sourceUrl: string;
    sourceKind: "web_fetch" | "browser";
    quotes: string[];
  }>;
  requiredToolCounts: Array<{
    toolAction: string;
    minimum: number;
    maximum: number;
  }>;
  security?: {
    forbiddenOutputStrings: string[];
    forbiddenToolActions: string[];
    requireExactFinalResponse: boolean;
  };
}

export interface OpenWebResearchBenchmarkCase {
  kind: "napier.open-web-research-benchmark-case";
  schemaVersion: 1 | 2;
  id: string;
  title: string;
  objective: string;
  promptPath: string;
  expectedPath: string;
  timeoutMs: number;
  promptSha256: string;
  expectedSha256: string;
  contentSha256: string;
}

export interface OpenWebResearchToolEvidence {
  toolSequence: string[];
  attemptedToolSequence?: string[];
  sourceEvidence: Array<{
    sourceUrlSha256: string;
    sourceKind: "web_fetch" | "browser";
    webSourceFormat?: "html" | "markdown" | "json" | "text" | "pdf";
  }>;
  citationEvidence: Array<{
    sourceUrlSha256: string;
    sourceKind: "web_fetch" | "browser";
    citationClaimSha256: string;
    citationQuoteSha256: string;
    citationTokenSha256: string;
  }>;
  claimEvidence: Array<{
    claimSha256: string;
    citationTokenSha256: string;
  }>;
  eventReceipts: Array<{
    seq: number;
    type: string;
    payloadSha256: string;
    previousReceiptSha256: string;
    receiptSha256: string;
  }>;
}

export interface OpenWebResearchBenchmarkResult {
  kind: "napier.open-web-research-benchmark-result";
  schemaVersion: 1 | 2;
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
    runId: string;
    status: RunStatus;
    durationMs: number;
    usage: Usage;
  };
  expectedClaimsSha256: string;
  actualClaimsSha256?: string;
  claimsMatch: boolean;
  requiredToolSetSha256: string;
  actualToolSequenceSha256: string;
  toolTopologyMatch: boolean;
  expectedSourceEvidenceSha256: string;
  actualSourceEvidenceSha256: string;
  expectedCitationEvidenceSha256: string;
  actualCitationEvidenceSha256: string;
  citationEvidenceMatch: boolean;
  expectedSourceUrlSetSha256: string;
  actualSourceUrlSetSha256: string;
  sourceCoverageMatch: boolean;
  searchCount: number;
  fetchCount: number;
  browserCount: number;
  researchCaptureCount: number;
  citationCount: number;
  citationSourceKindCount: {
    webFetch: number;
    browser: number;
  };
  citationClaimsMatch: boolean;
  adjacentCitationCount: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  security?: {
    expectedForbiddenOutputSetSha256: string;
    expectedForbiddenToolActionSetSha256: string;
    actualAttemptedToolSequenceSha256: string;
    assistantOutputSha256: string;
    assistantOutputLineCount: number;
    finalResponseExact: boolean;
    promptInjectionLeakDetected: boolean;
    forbiddenToolAttemptDetected: boolean;
  };
  diagnostics: string[];
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  sourceEventReceiptSetSha256: string;
  retainedEventCount: number;
  evidence: OpenWebResearchToolEvidence;
  contentSha256: string;
}

export interface OpenWebResearchBenchmarkArtifacts {
  result: OpenWebResearchBenchmarkResult;
  resultPath: string;
}

export interface OpenWebResearchBenchmarkMetricSummary {
  total: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface OpenWebResearchSecuritySeries {
  kind: "napier.open-web-research-security-series";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: OpenWebResearchBenchmarkResult["environment"];
  status: "completed" | "cancelled";
  requestedTrialCount: number;
  completedTrialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  promptInjectionLeakTrialCount: number;
  forbiddenToolAttemptTrialCount: number;
  exactFinalResponseTrialCount: number;
  replayValidTrialCount: number;
  credentialLeakTrialCount: number;
  completionRate: number;
  passRate: number | null;
  exactFinalResponseRate: number | null;
  metrics: {
    durationMs: OpenWebResearchBenchmarkMetricSummary;
    costUsd: OpenWebResearchBenchmarkMetricSummary;
    inputTokens: OpenWebResearchBenchmarkMetricSummary;
    outputTokens: OpenWebResearchBenchmarkMetricSummary;
  };
  trials: Array<{
    index: number;
    threadId: string;
    status: OpenWebResearchBenchmarkResult["status"];
    resultFileName: string;
    resultSha256: string;
    assistantOutputSha256: string;
    actualAttemptedToolSequenceSha256: string;
    finalResponseExact: boolean;
    promptInjectionLeakDetected: boolean;
    forbiddenToolAttemptDetected: boolean;
    replayValid: boolean;
    credentialLeakDetected: boolean;
  }>;
  resultSetSha256: string;
  contentSha256: string;
}

export interface OpenWebResearchSecuritySeriesArtifacts {
  series: OpenWebResearchSecuritySeries;
  seriesPath: string;
  trials: OpenWebResearchBenchmarkArtifacts[];
}

export interface OpenWebResearchSecuritySeriesVerification {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{ index: number; diagnostics: string[] }>;
}
