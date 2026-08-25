import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { loadOpenWebResearchBenchmarkCase } from "./open-web-research-benchmark-case.js";
import {
  openWebResearchResultFileName,
  runOpenWebResearchBenchmark,
  type OpenWebResearchBenchmarkDependencies,
  type RunOpenWebResearchBenchmarkOptions,
} from "./open-web-research-benchmark.js";
import type {
  OpenWebResearchBenchmarkArtifacts,
  OpenWebResearchBenchmarkMetricSummary,
  OpenWebResearchBenchmarkResult,
  OpenWebResearchSeries,
  OpenWebResearchSeriesArtifacts,
  OpenWebResearchSeriesVerification,
} from "./open-web-research-benchmark-types.js";
import { verifyOpenWebResearchBenchmarkAgainstCase } from "./open-web-research-benchmark-verifier.js";
import { validOpenWebResearchSeriesShape } from "./open-web-research-series-shape.js";

export interface RunOpenWebResearchSeriesOptions extends RunOpenWebResearchBenchmarkOptions {
  trialCount: number;
}

export async function runOpenWebResearchSeries(
  options: RunOpenWebResearchSeriesOptions,
  dependencies?: OpenWebResearchBenchmarkDependencies,
): Promise<OpenWebResearchSeriesArtifacts> {
  validateTrialCount(options.trialCount);
  const loaded = await loadOpenWebResearchBenchmarkCase(options.caseRoot);
  if (loaded.benchmarkCase.schemaVersion !== 1 || loaded.expected.security) {
    throw new Error("Open-web Research Series requires a schema-1 case");
  }
  const trials: OpenWebResearchBenchmarkArtifacts[] = [];
  for (let index = 0; index < options.trialCount; index += 1) {
    options.signal?.throwIfAborted();
    trials.push(await runOpenWebResearchBenchmark(options, dependencies));
    if (options.signal?.aborted) break;
  }
  const now = dependencies?.now ?? (() => new Date());
  const series = createOpenWebResearchSeries({
    generatedAt: now().toISOString(),
    requestedTrialCount: options.trialCount,
    status: trials.length === options.trialCount ? "completed" : "cancelled",
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    openWebResearchSeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyOpenWebResearchSeries(
    series,
    trialVerificationInputs(trials),
    loaded.benchmarkCase,
    loaded.expected,
  );
  if (!verification.valid) {
    throw new Error(
      `Open-web Research Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createOpenWebResearchSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  status: OpenWebResearchSeries["status"];
  trials: OpenWebResearchBenchmarkArtifacts[];
}): OpenWebResearchSeries {
  const first = input.trials[0]?.result;
  validateSeriesInput(input, first);
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  for (const trial of input.trials) {
    if (!consistentTrial(first!, trial, resultHashes, threadIds)) {
      throw new Error("Open-web Research Series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    threadIds.add(trial.result.run.threadId);
  }
  const trialEntries = input.trials.map((trial, offset) =>
    trialEntry(trial, offset + 1),
  );
  const passedTrialCount = statusCount(trialEntries, "passed");
  const content = {
    kind: "napier.open-web-research-series" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first!.caseId,
    caseSha256: first!.caseSha256,
    model: structuredClone(first!.model),
    environment: structuredClone(first!.environment),
    status: input.status,
    requestedTrialCount: input.requestedTrialCount,
    completedTrialCount: trialEntries.length,
    passedTrialCount,
    failedTrialCount: statusCount(trialEntries, "failed"),
    inconclusiveTrialCount: statusCount(trialEntries, "inconclusive"),
    claimsMatchTrialCount: booleanCount(trialEntries, "claimsMatch"),
    toolTopologyMatchTrialCount: booleanCount(
      trialEntries,
      "toolTopologyMatch",
    ),
    sourceCoverageMatchTrialCount: booleanCount(
      trialEntries,
      "sourceCoverageMatch",
    ),
    citationEvidenceMatchTrialCount: booleanCount(
      trialEntries,
      "citationEvidenceMatch",
    ),
    citationClaimsMatchTrialCount: booleanCount(
      trialEntries,
      "citationClaimsMatch",
    ),
    replayValidTrialCount: booleanCount(trialEntries, "replayValid"),
    credentialLeakTrialCount: booleanCount(
      trialEntries,
      "credentialLeakDetected",
    ),
    completionRate: trialEntries.length / input.requestedTrialCount,
    passRate:
      trialEntries.length === 0 ? null : passedTrialCount / trialEntries.length,
    metrics: createMetrics(input.trials),
    trials: trialEntries,
    resultSetSha256: sha256(
      canonicalJson(trialEntries.map((trial) => trial.resultSha256)),
    ),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyOpenWebResearchSeries(
  input: unknown,
  artifacts: Array<{ resultFileName: string; result: unknown }>,
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1],
  expected: Parameters<typeof verifyOpenWebResearchBenchmarkAgainstCase>[2],
): OpenWebResearchSeriesVerification {
  if (!validOpenWebResearchSeriesShape(input)) return invalidSeries(input);
  const series = input;
  const diagnostics: string[] = [];
  if (artifacts.length !== series.trials.length) {
    diagnostics.push("series_artifact_count_mismatch");
  }
  const trialDiagnostics = series.trials.map((trial) => {
    const artifact = artifacts[trial.index - 1];
    const verification = artifact
      ? verifyOpenWebResearchBenchmarkAgainstCase(
          artifact.result,
          benchmarkCase,
          expected,
        )
      : {
          valid: false,
          diagnostics: ["trial_artifact_missing"],
          resultSha256: "",
        };
    const issues = [...verification.diagnostics];
    if (
      !verification.valid ||
      !trialBindingMatches(trial, artifact, verification.resultSha256)
    ) {
      issues.push("trial_binding_mismatch");
    }
    return { index: trial.index, diagnostics: issues };
  });
  if (trialDiagnostics.some((trial) => trial.diagnostics.length > 0)) {
    diagnostics.push("series_trial_invalid");
  }
  const recreated = recreateSeries(series, artifacts, trialDiagnostics);
  if (
    !recreated ||
    canonicalJson(recreated as unknown as JsonValue) !==
      canonicalJson(series as unknown as JsonValue)
  ) {
    diagnostics.push("series_aggregate_mismatch");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    seriesSha256: series.contentSha256,
    trialDiagnostics,
  };
}

export function openWebResearchSeriesArtifactReferences(input: unknown) {
  if (!validOpenWebResearchSeriesShape(input)) {
    throw new Error("Open-web Research Series shape is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
  }));
}

export function openWebResearchSeriesFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-open-web-research-series-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function validateTrialCount(trialCount: number): void {
  if (!Number.isSafeInteger(trialCount) || trialCount < 2 || trialCount > 10) {
    throw new Error("Open-web Research Series trial count must be 2-10");
  }
}

function validateSeriesInput(
  input: {
    requestedTrialCount: number;
    status: OpenWebResearchSeries["status"];
    trials: OpenWebResearchBenchmarkArtifacts[];
  },
  first: OpenWebResearchBenchmarkResult | undefined,
): void {
  validateTrialCount(input.requestedTrialCount);
  if (
    !first ||
    first.schemaVersion !== 1 ||
    first.security !== undefined ||
    input.trials.length > input.requestedTrialCount ||
    (input.status === "completed" &&
      input.trials.length !== input.requestedTrialCount) ||
    (input.status === "cancelled" &&
      input.trials.length >= input.requestedTrialCount)
  ) {
    throw new Error("Open-web Research Series trials are invalid");
  }
}

function consistentTrial(
  first: OpenWebResearchBenchmarkResult,
  trial: OpenWebResearchBenchmarkArtifacts,
  resultHashes: Set<string>,
  threadIds: Set<string>,
): boolean {
  const result = trial.result;
  return (
    result.schemaVersion === 1 &&
    result.security === undefined &&
    result.caseId === first.caseId &&
    result.caseSha256 === first.caseSha256 &&
    canonicalJson(result.model as unknown as JsonValue) ===
      canonicalJson(first.model as unknown as JsonValue) &&
    canonicalJson(result.environment as unknown as JsonValue) ===
      canonicalJson(first.environment as unknown as JsonValue) &&
    path.basename(trial.resultPath) ===
      openWebResearchResultFileName(result.caseId, result.contentSha256) &&
    !resultHashes.has(result.contentSha256) &&
    !threadIds.has(result.run.threadId)
  );
}

function trialEntry(
  trial: OpenWebResearchBenchmarkArtifacts,
  index: number,
): OpenWebResearchSeries["trials"][number] {
  const result = trial.result;
  return {
    index,
    threadId: result.run.threadId,
    status: result.status,
    resultFileName: path.basename(trial.resultPath),
    resultSha256: result.contentSha256,
    actualToolSequenceSha256: result.actualToolSequenceSha256,
    actualSourceEvidenceSha256: result.actualSourceEvidenceSha256,
    actualCitationEvidenceSha256: result.actualCitationEvidenceSha256,
    claimsMatch: result.claimsMatch,
    toolTopologyMatch: result.toolTopologyMatch,
    sourceCoverageMatch: result.sourceCoverageMatch,
    citationEvidenceMatch: result.citationEvidenceMatch,
    citationClaimsMatch: result.citationClaimsMatch,
    replayValid: result.replayValid,
    credentialLeakDetected: result.credentialLeakDetected,
    searchCount: result.searchCount,
    fetchCount: result.fetchCount,
    browserCount: result.browserCount,
    researchCaptureCount: result.researchCaptureCount,
    citationCount: result.citationCount,
  };
}

function trialBindingMatches(
  trial: OpenWebResearchSeries["trials"][number],
  artifact: { resultFileName: string; result: unknown } | undefined,
  resultSha256: string,
): boolean {
  const result = artifact?.result as OpenWebResearchBenchmarkResult | undefined;
  return Boolean(
    artifact &&
    result &&
    artifact.resultFileName === trial.resultFileName &&
    resultSha256 === trial.resultSha256 &&
    canonicalJson(
      trialEntry({ result, resultPath: artifact.resultFileName }, trial.index),
    ) === canonicalJson(trial),
  );
}

function recreateSeries(
  series: OpenWebResearchSeries,
  artifacts: Array<{ resultFileName: string; result: unknown }>,
  diagnostics: Array<{ index: number; diagnostics: string[] }>,
) {
  if (diagnostics.some((trial) => trial.diagnostics.length > 0)) {
    return undefined;
  }
  try {
    return createOpenWebResearchSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      status: series.status,
      trials: artifacts.map((artifact) => ({
        result: artifact.result as OpenWebResearchBenchmarkResult,
        resultPath: artifact.resultFileName,
      })),
    });
  } catch {
    return undefined;
  }
}

function createMetrics(
  trials: OpenWebResearchBenchmarkArtifacts[],
): OpenWebResearchSeries["metrics"] {
  const values = (select: (result: OpenWebResearchBenchmarkResult) => number) =>
    trials.map((trial) => select(trial.result));
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
  if (values.length === 0) {
    return { total: 0, min: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  }
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

function trialVerificationInputs(trials: OpenWebResearchBenchmarkArtifacts[]) {
  return trials.map((trial) => ({
    resultFileName: path.basename(trial.resultPath),
    result: trial.result,
  }));
}

function statusCount(
  trials: OpenWebResearchSeries["trials"],
  status: OpenWebResearchBenchmarkResult["status"],
): number {
  return trials.filter((trial) => trial.status === status).length;
}

function booleanCount(
  trials: OpenWebResearchSeries["trials"],
  key:
    | "claimsMatch"
    | "toolTopologyMatch"
    | "sourceCoverageMatch"
    | "citationEvidenceMatch"
    | "citationClaimsMatch"
    | "replayValid"
    | "credentialLeakDetected",
): number {
  return trials.filter((trial) => trial[key]).length;
}

function invalidSeries(input: unknown): OpenWebResearchSeriesVerification {
  return {
    valid: false,
    diagnostics: ["series_shape_invalid"],
    seriesSha256: sha256(String(input)),
    trialDiagnostics: [],
  };
}
