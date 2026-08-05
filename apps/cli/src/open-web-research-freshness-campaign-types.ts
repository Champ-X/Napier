import type { ModelRef } from "@napier/contracts";

import type {
  OpenWebResearchBenchmarkMetricSummary,
  OpenWebResearchBenchmarkResult,
  OpenWebResearchSeries,
} from "./open-web-research-benchmark-types.js";

export type OpenWebResearchFreshnessObservationArtifact =
  | OpenWebResearchBenchmarkResult
  | OpenWebResearchSeries;

export interface OpenWebResearchFreshnessObservationArtifacts {
  artifactFileName: string;
  artifact: OpenWebResearchFreshnessObservationArtifact;
  trials: Array<{
    resultFileName: string;
    result: OpenWebResearchBenchmarkResult;
  }>;
}

export interface OpenWebResearchFreshnessCampaign {
  kind: "napier.open-web-research-freshness-campaign";
  schemaVersion: 1;
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  model: ModelRef;
  environment: OpenWebResearchBenchmarkResult["environment"];
  requiredObservationGapMs: number;
  observationCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  observationSpanMs: number;
  minimumObservationGapMs: number;
  trialCount: number;
  passedTrialCount: number;
  failedTrialCount: number;
  inconclusiveTrialCount: number;
  claimsMatchTrialCount: number;
  toolTopologyMatchTrialCount: number;
  sourceCoverageMatchTrialCount: number;
  citationEvidenceMatchTrialCount: number;
  citationClaimsMatchTrialCount: number;
  replayValidTrialCount: number;
  credentialLeakTrialCount: number;
  passRate: number;
  uniqueSourceEvidenceCount: number;
  uniqueCitationEvidenceCount: number;
  sourceEvidenceSetSha256: string;
  citationEvidenceSetSha256: string;
  metrics: {
    durationMs: OpenWebResearchBenchmarkMetricSummary;
    costUsd: OpenWebResearchBenchmarkMetricSummary;
    inputTokens: OpenWebResearchBenchmarkMetricSummary;
    outputTokens: OpenWebResearchBenchmarkMetricSummary;
    searchCount: OpenWebResearchBenchmarkMetricSummary;
    fetchCount: OpenWebResearchBenchmarkMetricSummary;
    browserCount: OpenWebResearchBenchmarkMetricSummary;
    researchCaptureCount: OpenWebResearchBenchmarkMetricSummary;
    citationCount: OpenWebResearchBenchmarkMetricSummary;
  };
  observations: Array<{
    index: number;
    artifactKind: "result" | "series";
    artifactFileName: string;
    artifactContentSha256: string;
    firstObservedAt: string;
    lastObservedAt: string;
    trialCount: number;
    passedTrialCount: number;
    failedTrialCount: number;
    inconclusiveTrialCount: number;
    claimsMatchTrialCount: number;
    toolTopologyMatchTrialCount: number;
    sourceCoverageMatchTrialCount: number;
    citationEvidenceMatchTrialCount: number;
    citationClaimsMatchTrialCount: number;
    replayValidTrialCount: number;
    credentialLeakTrialCount: number;
    resultSetSha256: string;
  }>;
  observationSetSha256: string;
  resultSetSha256: string;
  contentSha256: string;
}

export interface OpenWebResearchFreshnessCampaignArtifacts {
  campaign: OpenWebResearchFreshnessCampaign;
  campaignPath: string;
  observations: OpenWebResearchFreshnessObservationArtifacts[];
}

export interface OpenWebResearchFreshnessCampaignVerification {
  valid: boolean;
  diagnostics: string[];
  campaignSha256: string;
  observationDiagnostics: Array<{
    index: number;
    diagnostics: string[];
  }>;
}
