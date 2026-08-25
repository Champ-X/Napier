import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  OpenWebResearchBenchmarkMetricSummary,
  OpenWebResearchBenchmarkResult,
} from "./open-web-research-benchmark-types.js";
import type { OpenWebResearchFreshnessCampaign } from "./open-web-research-freshness-campaign-types.js";

export function createOpenWebResearchFreshnessSummary(
  results: OpenWebResearchBenchmarkResult[],
): Pick<
  OpenWebResearchFreshnessCampaign,
  | "trialCount"
  | "passedTrialCount"
  | "failedTrialCount"
  | "inconclusiveTrialCount"
  | "claimsMatchTrialCount"
  | "toolTopologyMatchTrialCount"
  | "sourceCoverageMatchTrialCount"
  | "citationEvidenceMatchTrialCount"
  | "citationClaimsMatchTrialCount"
  | "replayValidTrialCount"
  | "credentialLeakTrialCount"
  | "passRate"
  | "uniqueSourceEvidenceCount"
  | "uniqueCitationEvidenceCount"
  | "sourceEvidenceSetSha256"
  | "citationEvidenceSetSha256"
  | "metrics"
  | "resultSetSha256"
> {
  const sourceEvidence = sortedUnique(
    results.map((result) => result.actualSourceEvidenceSha256),
  );
  const citationEvidence = sortedUnique(
    results.map((result) => result.actualCitationEvidenceSha256),
  );
  const passedTrialCount = statusCount(results, "passed");
  return {
    trialCount: results.length,
    passedTrialCount,
    failedTrialCount: statusCount(results, "failed"),
    inconclusiveTrialCount: statusCount(results, "inconclusive"),
    claimsMatchTrialCount: booleanCount(results, "claimsMatch"),
    toolTopologyMatchTrialCount: booleanCount(results, "toolTopologyMatch"),
    sourceCoverageMatchTrialCount: booleanCount(results, "sourceCoverageMatch"),
    citationEvidenceMatchTrialCount: booleanCount(
      results,
      "citationEvidenceMatch",
    ),
    citationClaimsMatchTrialCount: booleanCount(results, "citationClaimsMatch"),
    replayValidTrialCount: booleanCount(results, "replayValid"),
    credentialLeakTrialCount: booleanCount(results, "credentialLeakDetected"),
    passRate: passedTrialCount / results.length,
    uniqueSourceEvidenceCount: sourceEvidence.length,
    uniqueCitationEvidenceCount: citationEvidence.length,
    sourceEvidenceSetSha256: sha256(canonicalJson(sourceEvidence)),
    citationEvidenceSetSha256: sha256(canonicalJson(citationEvidence)),
    metrics: createMetrics(results),
    resultSetSha256: sha256(
      canonicalJson(results.map((result) => result.contentSha256)),
    ),
  };
}

export function statusCount(
  results: OpenWebResearchBenchmarkResult[],
  status: OpenWebResearchBenchmarkResult["status"],
): number {
  return results.filter((result) => result.status === status).length;
}

export function booleanCount(
  results: OpenWebResearchBenchmarkResult[],
  key:
    | "claimsMatch"
    | "toolTopologyMatch"
    | "sourceCoverageMatch"
    | "citationEvidenceMatch"
    | "citationClaimsMatch"
    | "replayValid"
    | "credentialLeakDetected",
): number {
  return results.filter((result) => result[key]).length;
}

function createMetrics(
  results: OpenWebResearchBenchmarkResult[],
): OpenWebResearchFreshnessCampaign["metrics"] {
  const values = (select: (result: OpenWebResearchBenchmarkResult) => number) =>
    results.map(select);
  return {
    durationMs: metricSummary(values((result) => result.run.durationMs)),
    costUsd: metricSummary(values((result) => result.run.usage.costUsd)),
    inputTokens: metricSummary(
      values((result) => result.run.usage.inputTokens),
    ),
    outputTokens: metricSummary(
      values((result) => result.run.usage.outputTokens),
    ),
    searchCount: metricSummary(values((result) => result.searchCount)),
    fetchCount: metricSummary(values((result) => result.fetchCount)),
    browserCount: metricSummary(values((result) => result.browserCount)),
    researchCaptureCount: metricSummary(
      values((result) => result.researchCaptureCount),
    ),
    citationCount: metricSummary(values((result) => result.citationCount)),
  };
}

function metricSummary(
  values: number[],
): OpenWebResearchBenchmarkMetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    total,
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
    mean: total / values.length,
  };
}

function percentile(sorted: number[], value: number): number {
  return sorted[Math.floor((sorted.length - 1) * value)]!;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
