import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { openWebResearchResultFileName } from "./open-web-research-benchmark.js";
import type {
  OpenWebResearchBenchmarkExpected,
  OpenWebResearchBenchmarkResult,
  OpenWebResearchSeries,
} from "./open-web-research-benchmark-types.js";
import { verifyOpenWebResearchBenchmarkAgainstCase } from "./open-web-research-benchmark-verifier.js";
import {
  OPEN_WEB_RESEARCH_OBSERVATION_GAP_MS,
  validOpenWebResearchFreshnessCampaignShape,
} from "./open-web-research-freshness-campaign-shape.js";
import type {
  OpenWebResearchFreshnessCampaign,
  OpenWebResearchFreshnessCampaignArtifacts,
  OpenWebResearchFreshnessCampaignVerification,
  OpenWebResearchFreshnessObservationArtifacts,
} from "./open-web-research-freshness-campaign-types.js";
import {
  booleanCount,
  createOpenWebResearchFreshnessSummary,
  statusCount,
} from "./open-web-research-freshness-summary.js";
import {
  openWebResearchSeriesFileName,
  verifyOpenWebResearchSeries,
} from "./open-web-research-series.js";

export async function writeOpenWebResearchFreshnessCampaign(input: {
  generatedAt: string;
  outputDir: string;
  observations: OpenWebResearchFreshnessObservationArtifacts[];
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1];
  expected: OpenWebResearchBenchmarkExpected;
}): Promise<OpenWebResearchFreshnessCampaignArtifacts> {
  assertObservationEvidence(
    input.observations,
    input.benchmarkCase,
    input.expected,
  );
  const campaign = createOpenWebResearchFreshnessCampaign(input);
  const verification = verifyOpenWebResearchFreshnessCampaign(
    campaign,
    input.observations,
    input.benchmarkCase,
    input.expected,
  );
  if (!verification.valid) {
    throw new Error(
      `Open-web Research freshness campaign failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  const campaignPath = path.join(
    path.resolve(input.outputDir),
    openWebResearchFreshnessCampaignFileName(
      campaign.caseId,
      campaign.contentSha256,
    ),
  );
  await writeBenchmarkCasFile(
    campaignPath,
    `${JSON.stringify(campaign, null, 2)}\n`,
  );
  return { campaign, campaignPath, observations: input.observations };
}

export function createOpenWebResearchFreshnessCampaign(input: {
  generatedAt: string;
  observations: OpenWebResearchFreshnessObservationArtifacts[];
}): OpenWebResearchFreshnessCampaign {
  if (input.observations.length < 2 || input.observations.length > 10) {
    throw new Error(
      "Open-web Research freshness campaign requires 2-10 observations",
    );
  }
  const observations = [...input.observations]
    .map(observationProjection)
    .sort((left, right) =>
      left.summary.firstObservedAt.localeCompare(right.summary.firstObservedAt),
    );
  validateCampaignObservations(observations);
  const results = observations.flatMap((observation) => observation.results);
  const first = results[0]!;
  const observationEntries = observations.map(
    (observation, index) =>
      ({
        index: index + 1,
        ...observation.summary,
      }) satisfies OpenWebResearchFreshnessCampaign["observations"][number],
  );
  if (
    !validIsoDate(input.generatedAt) ||
    Date.parse(input.generatedAt) <
      Date.parse(observationEntries.at(-1)!.lastObservedAt)
  ) {
    throw new Error(
      "Open-web Research freshness campaign generation time is invalid",
    );
  }
  const content = {
    kind: "napier.open-web-research-freshness-campaign" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first.caseId,
    caseSha256: first.caseSha256,
    model: structuredClone(first.model),
    environment: structuredClone(first.environment),
    requiredObservationGapMs: OPEN_WEB_RESEARCH_OBSERVATION_GAP_MS,
    observationCount: observationEntries.length,
    firstObservedAt: observationEntries[0]!.firstObservedAt,
    lastObservedAt: observationEntries.at(-1)!.lastObservedAt,
    observationSpanMs:
      Date.parse(observationEntries.at(-1)!.lastObservedAt) -
      Date.parse(observationEntries[0]!.firstObservedAt),
    minimumObservationGapMs: minimumObservationGap(observationEntries),
    ...createOpenWebResearchFreshnessSummary(results),
    observations: observationEntries,
    observationSetSha256: sha256(
      canonicalJson(
        observationEntries.map(
          (observation) => observation.artifactContentSha256,
        ),
      ),
    ),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyOpenWebResearchFreshnessCampaign(
  input: unknown,
  observations: OpenWebResearchFreshnessObservationArtifacts[],
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1],
  expected: OpenWebResearchBenchmarkExpected,
): OpenWebResearchFreshnessCampaignVerification {
  if (!validOpenWebResearchFreshnessCampaignShape(input)) {
    return invalidCampaign(input);
  }
  const campaign = input;
  const diagnostics: string[] = [];
  if (observations.length !== campaign.observations.length) {
    diagnostics.push("campaign_artifact_count_mismatch");
  }
  const observationDiagnostics = campaign.observations.map((observation) => {
    const artifacts = observations.find(
      (candidate) =>
        candidate.artifactFileName === observation.artifactFileName,
    );
    const issues = artifacts
      ? verifyObservationArtifacts(
          artifacts,
          observation,
          benchmarkCase,
          expected,
        )
      : ["observation_artifact_missing"];
    return { index: observation.index, diagnostics: issues };
  });
  if (
    observationDiagnostics.some(
      (observation) => observation.diagnostics.length > 0,
    )
  ) {
    diagnostics.push("campaign_observation_invalid");
  }
  const recreated = recreateCampaign(
    campaign,
    observations,
    observationDiagnostics,
  );
  if (
    !recreated ||
    canonicalJson(recreated as unknown as JsonValue) !==
      canonicalJson(campaign as unknown as JsonValue)
  ) {
    diagnostics.push("campaign_aggregate_mismatch");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    campaignSha256: campaign.contentSha256,
    observationDiagnostics,
  };
}

export function openWebResearchFreshnessCampaignArtifactReferences(
  input: unknown,
) {
  if (!validOpenWebResearchFreshnessCampaignShape(input)) {
    throw new Error("Open-web Research freshness campaign shape is invalid");
  }
  return input.observations.map((observation) => ({
    index: observation.index,
    artifactKind: observation.artifactKind,
    artifactFileName: observation.artifactFileName,
  }));
}

export function openWebResearchFreshnessCampaignFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-open-web-research-freshness-campaign-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function observationProjection(
  input: OpenWebResearchFreshnessObservationArtifacts,
) {
  const artifact = input.artifact;
  const kind =
    artifact.kind === "napier.open-web-research-series" ? "series" : "result";
  const expectedFileName =
    kind === "series"
      ? openWebResearchSeriesFileName(artifact.caseId, artifact.contentSha256)
      : openWebResearchResultFileName(artifact.caseId, artifact.contentSha256);
  if (
    path.basename(input.artifactFileName) !== input.artifactFileName ||
    input.artifactFileName !== expectedFileName
  ) {
    throw new Error(
      "Open-web Research freshness observation filename is invalid",
    );
  }
  const results = observationResults(input, kind);
  const observedAt = results
    .map((result) => result.generatedAt)
    .sort((left, right) => left.localeCompare(right));
  return {
    input,
    results,
    summary: {
      artifactKind: kind,
      artifactFileName: input.artifactFileName,
      artifactContentSha256: artifact.contentSha256,
      firstObservedAt: observedAt[0]!,
      lastObservedAt: observedAt.at(-1)!,
      trialCount: results.length,
      passedTrialCount: statusCount(results, "passed"),
      failedTrialCount: statusCount(results, "failed"),
      inconclusiveTrialCount: statusCount(results, "inconclusive"),
      claimsMatchTrialCount: booleanCount(results, "claimsMatch"),
      toolTopologyMatchTrialCount: booleanCount(results, "toolTopologyMatch"),
      sourceCoverageMatchTrialCount: booleanCount(
        results,
        "sourceCoverageMatch",
      ),
      citationEvidenceMatchTrialCount: booleanCount(
        results,
        "citationEvidenceMatch",
      ),
      citationClaimsMatchTrialCount: booleanCount(
        results,
        "citationClaimsMatch",
      ),
      replayValidTrialCount: booleanCount(results, "replayValid"),
      credentialLeakTrialCount: booleanCount(results, "credentialLeakDetected"),
      resultSetSha256: sha256(
        canonicalJson(results.map((result) => result.contentSha256)),
      ),
    } satisfies Omit<
      OpenWebResearchFreshnessCampaign["observations"][number],
      "index"
    >,
  };
}

function observationResults(
  input: OpenWebResearchFreshnessObservationArtifacts,
  kind: "result" | "series",
): OpenWebResearchBenchmarkResult[] {
  if (kind === "result") {
    const result = input.artifact as OpenWebResearchBenchmarkResult;
    if (
      input.trials.length !== 1 ||
      input.trials[0]?.resultFileName !== input.artifactFileName ||
      input.trials[0]?.result.contentSha256 !== result.contentSha256
    ) {
      throw new Error(
        "Open-web Research singleton observation binding is invalid",
      );
    }
    return [result];
  }
  const series = input.artifact as OpenWebResearchSeries;
  if (
    series.status !== "completed" ||
    series.completedTrialCount !== series.requestedTrialCount ||
    input.trials.length !== series.trials.length
  ) {
    throw new Error("Open-web Research Series observation is incomplete");
  }
  return series.trials.map((trial, index) => {
    const artifact = input.trials[index];
    if (
      !artifact ||
      artifact.resultFileName !== trial.resultFileName ||
      artifact.result.contentSha256 !== trial.resultSha256
    ) {
      throw new Error(
        "Open-web Research Series observation binding is invalid",
      );
    }
    return artifact.result;
  });
}

function validateCampaignObservations(
  observations: ReturnType<typeof observationProjection>[],
): void {
  const first = observations[0]!.results[0]!;
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  const artifactHashes = new Set<string>();
  for (const observation of observations) {
    if (artifactHashes.has(observation.summary.artifactContentSha256)) {
      throw new Error(
        "Open-web Research freshness observations are duplicated",
      );
    }
    artifactHashes.add(observation.summary.artifactContentSha256);
    for (const result of observation.results) {
      if (
        result.schemaVersion !== 1 ||
        result.security !== undefined ||
        result.caseId !== first.caseId ||
        result.caseSha256 !== first.caseSha256 ||
        canonicalJson(result.model as unknown as JsonValue) !==
          canonicalJson(first.model as unknown as JsonValue) ||
        canonicalJson(result.environment as unknown as JsonValue) !==
          canonicalJson(first.environment as unknown as JsonValue) ||
        resultHashes.has(result.contentSha256) ||
        threadIds.has(result.run.threadId)
      ) {
        throw new Error(
          "Open-web Research freshness observation trials are inconsistent",
        );
      }
      resultHashes.add(result.contentSha256);
      threadIds.add(result.run.threadId);
    }
  }
  if (
    minimumObservationGap(
      observations.map((observation, index) => ({
        index: index + 1,
        ...observation.summary,
      })),
    ) < OPEN_WEB_RESEARCH_OBSERVATION_GAP_MS
  ) {
    throw new Error(
      "Open-web Research freshness observations must be at least 24 hours apart",
    );
  }
}

function verifyObservationArtifacts(
  artifacts: OpenWebResearchFreshnessObservationArtifacts,
  observation: OpenWebResearchFreshnessCampaign["observations"][number],
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1],
  expected: OpenWebResearchBenchmarkExpected,
): string[] {
  const issues: string[] = [];
  if (observation.artifactKind === "result") {
    const verification = verifyOpenWebResearchBenchmarkAgainstCase(
      artifacts.artifact,
      benchmarkCase,
      expected,
    );
    issues.push(...verification.diagnostics);
  } else {
    const verification = verifyOpenWebResearchSeries(
      artifacts.artifact,
      artifacts.trials,
      benchmarkCase,
      expected,
    );
    issues.push(...verification.diagnostics);
  }
  if (issues.length > 0) return issues;
  try {
    const projected = observationProjection(artifacts);
    const expectedObservation = {
      index: observation.index,
      ...projected.summary,
    };
    if (
      canonicalJson(expectedObservation as unknown as JsonValue) !==
      canonicalJson(observation as unknown as JsonValue)
    ) {
      issues.push("observation_binding_mismatch");
    }
  } catch {
    issues.push("observation_binding_mismatch");
  }
  return issues;
}

function assertObservationEvidence(
  observations: OpenWebResearchFreshnessObservationArtifacts[],
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1],
  expected: OpenWebResearchBenchmarkExpected,
): void {
  for (const observation of observations) {
    const artifact = observation.artifact;
    const verification =
      artifact.kind === "napier.open-web-research-series"
        ? verifyOpenWebResearchSeries(
            artifact,
            observation.trials,
            benchmarkCase,
            expected,
          )
        : verifyOpenWebResearchBenchmarkAgainstCase(
            artifact,
            benchmarkCase,
            expected,
          );
    if (!verification.valid) {
      throw new Error(
        `Open-web Research freshness observation failed verification: ${verification.diagnostics.join(",")}`,
      );
    }
  }
}

function recreateCampaign(
  campaign: OpenWebResearchFreshnessCampaign,
  observations: OpenWebResearchFreshnessObservationArtifacts[],
  diagnostics: Array<{ index: number; diagnostics: string[] }>,
) {
  if (diagnostics.some((observation) => observation.diagnostics.length > 0)) {
    return undefined;
  }
  try {
    return createOpenWebResearchFreshnessCampaign({
      generatedAt: campaign.generatedAt,
      observations,
    });
  } catch {
    return undefined;
  }
}

function minimumObservationGap(
  observations: OpenWebResearchFreshnessCampaign["observations"],
): number {
  if (observations.length < 2) return 0;
  return Math.min(
    ...observations
      .slice(1)
      .map(
        (observation, index) =>
          Date.parse(observation.firstObservedAt) -
          Date.parse(observations[index]!.lastObservedAt),
      ),
  );
}

function invalidCampaign(
  input: unknown,
): OpenWebResearchFreshnessCampaignVerification {
  return {
    valid: false,
    diagnostics: ["campaign_shape_invalid"],
    campaignSha256: sha256(String(input)),
    observationDiagnostics: [],
  };
}

function validIsoDate(value: string): boolean {
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
