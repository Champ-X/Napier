import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import {
  researchBenchmarkLedgerFileName,
  researchBenchmarkResultFileName,
  verifyResearchBenchmarkArtifacts,
} from "./research-benchmark-contract.js";
import {
  runResearchBenchmark,
  type ResearchBenchmarkDependencies,
  type RunResearchBenchmarkOptions,
} from "./research-benchmark.js";
import { validResearchBenchmarkSeriesShape } from "./research-benchmark-series-shape.js";
import type {
  ResearchBenchmarkArtifacts,
  ResearchBenchmarkMetricSummary,
  ResearchBenchmarkResult,
  ResearchBenchmarkSeries,
  ResearchBenchmarkSeriesArtifacts,
  ResearchBenchmarkSeriesVerification,
} from "./research-benchmark-types.js";

export interface RunResearchBenchmarkSeriesOptions extends RunResearchBenchmarkOptions {
  trialCount: number;
}

export async function runResearchBenchmarkSeries(
  options: RunResearchBenchmarkSeriesOptions,
  dependencies?: ResearchBenchmarkDependencies,
): Promise<ResearchBenchmarkSeriesArtifacts> {
  if (
    !Number.isSafeInteger(options.trialCount) ||
    options.trialCount < 2 ||
    options.trialCount > 10
  ) {
    throw new Error("Research benchmark trial count must be 2-10");
  }
  const trials: ResearchBenchmarkArtifacts[] = [];
  for (let index = 0; index < options.trialCount; index += 1) {
    options.signal?.throwIfAborted();
    trials.push(await runResearchBenchmark(options, dependencies));
    if (options.signal?.aborted) break;
  }
  const now = dependencies?.now ?? (() => new Date());
  const series = createResearchBenchmarkSeries({
    generatedAt: now().toISOString(),
    requestedTrialCount: options.trialCount,
    status: trials.length === options.trialCount ? "completed" : "cancelled",
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    researchBenchmarkSeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyResearchBenchmarkSeries(
    series,
    trialVerificationInputs(trials),
  );
  if (!verification.valid) {
    throw new Error(
      `Research benchmark Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createResearchBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  status: ResearchBenchmarkSeries["status"];
  trials: ResearchBenchmarkArtifacts[];
}): ResearchBenchmarkSeries {
  const first = input.trials[0]?.result;
  if (
    !first ||
    !Number.isSafeInteger(input.requestedTrialCount) ||
    input.requestedTrialCount < 2 ||
    input.requestedTrialCount > 10 ||
    input.trials.length > input.requestedTrialCount ||
    (input.status === "completed" &&
      input.trials.length !== input.requestedTrialCount) ||
    (input.status === "cancelled" &&
      input.trials.length >= input.requestedTrialCount)
  ) {
    throw new Error("Research benchmark Series trial count is invalid");
  }
  const resultHashes = new Set<string>();
  const ledgerHashes = new Set<string>();
  const threadIds = new Set<string>();
  for (const trial of input.trials) {
    const resultFileName = path.basename(trial.resultPath);
    const ledgerFileName = path.basename(trial.ledgerPath);
    if (
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.model as unknown as JsonValue) !==
        canonicalJson(first.model as unknown as JsonValue) ||
      canonicalJson(trial.result.environment as unknown as JsonValue) !==
        canonicalJson(first.environment as unknown as JsonValue) ||
      resultFileName !==
        researchBenchmarkResultFileName(
          trial.result.caseId,
          trial.result.contentSha256,
        ) ||
      ledgerFileName !==
        researchBenchmarkLedgerFileName(
          trial.result.caseId,
          trial.bundle.contentSha256,
        ) ||
      trial.result.ledger.bundleFileName !== ledgerFileName ||
      trial.result.ledger.bundleSha256 !== trial.bundle.contentSha256 ||
      resultHashes.has(trial.result.contentSha256) ||
      ledgerHashes.has(trial.bundle.contentSha256) ||
      threadIds.has(trial.result.run.threadId)
    ) {
      throw new Error("Research benchmark Series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    ledgerHashes.add(trial.bundle.contentSha256);
    threadIds.add(trial.result.run.threadId);
  }
  const trialEntries = input.trials.map((trial, offset) => ({
    index: offset + 1,
    threadId: trial.result.run.threadId,
    status: trial.result.status,
    resultFileName: path.basename(trial.resultPath),
    resultSha256: trial.result.contentSha256,
    ledgerFileName: path.basename(trial.ledgerPath),
    ledgerSha256: trial.bundle.contentSha256,
  }));
  const passedTrialCount = trialEntries.filter(
    (trial) => trial.status === "passed",
  ).length;
  const failedTrialCount = trialEntries.filter(
    (trial) => trial.status === "failed",
  ).length;
  const inconclusiveTrialCount = trialEntries.filter(
    (trial) => trial.status === "inconclusive",
  ).length;
  const content = {
    kind: "napier.research-benchmark-series" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first.caseId,
    caseSha256: first.caseSha256,
    model: structuredClone(first.model),
    environment: structuredClone(first.environment),
    status: input.status,
    requestedTrialCount: input.requestedTrialCount,
    completedTrialCount: trialEntries.length,
    passedTrialCount,
    failedTrialCount,
    inconclusiveTrialCount,
    completionRate: trialEntries.length / input.requestedTrialCount,
    passRate:
      trialEntries.length === 0 ? null : passedTrialCount / trialEntries.length,
    metrics: {
      durationMs: metricSummary(
        input.trials.map((trial) => trial.result.run.durationMs),
      ),
      costUsd: metricSummary(
        input.trials.map((trial) => trial.result.run.usage.costUsd),
      ),
      inputTokens: metricSummary(
        input.trials.map((trial) => trial.result.run.usage.inputTokens),
      ),
      outputTokens: metricSummary(
        input.trials.map((trial) => trial.result.run.usage.outputTokens),
      ),
    },
    trials: trialEntries,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyResearchBenchmarkSeries(
  input: unknown,
  artifacts: Array<{
    resultFileName: string;
    result: unknown;
    bundle: unknown;
  }>,
): ResearchBenchmarkSeriesVerification {
  if (!validResearchBenchmarkSeriesShape(input)) {
    return {
      valid: false,
      diagnostics: ["series_shape_invalid"],
      seriesSha256: sha256(String(input)),
      trialDiagnostics: [],
    };
  }
  const series = input;
  const diagnostics: string[] = [];
  if (artifacts.length !== series.trials.length) {
    diagnostics.push("series_artifact_count_mismatch");
  }
  const trialDiagnostics = series.trials.map((trial) => {
    const artifact = artifacts[trial.index - 1];
    const verification = artifact
      ? verifyResearchBenchmarkArtifacts(artifact.result, artifact.bundle)
      : {
          valid: false,
          diagnostics: ["trial_artifact_missing"],
          resultSha256: "",
        };
    const issues = [...verification.diagnostics];
    const result = artifact?.result as ResearchBenchmarkResult | undefined;
    if (
      !artifact ||
      !verification.valid ||
      !result ||
      artifact.resultFileName !== trial.resultFileName ||
      verification.resultSha256 !== trial.resultSha256 ||
      verification.bundleSha256 !== trial.ledgerSha256 ||
      result.run.threadId !== trial.threadId ||
      result.status !== trial.status ||
      result.ledger.bundleFileName !== trial.ledgerFileName ||
      result.ledger.bundleSha256 !== trial.ledgerSha256
    ) {
      issues.push("trial_binding_mismatch");
    }
    return { index: trial.index, diagnostics: issues };
  });
  if (trialDiagnostics.some((trial) => trial.diagnostics.length > 0)) {
    diagnostics.push("series_trial_invalid");
  }
  const expected =
    artifacts.length === series.trials.length
      ? createResearchBenchmarkSeriesFromVerified(series, artifacts)
      : undefined;
  if (
    !expected ||
    canonicalJson(expected as unknown as JsonValue) !==
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

export function researchBenchmarkSeriesArtifactReferences(input: unknown) {
  if (!validResearchBenchmarkSeriesShape(input)) {
    throw new Error("Research benchmark Series shape is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

function createResearchBenchmarkSeriesFromVerified(
  series: ResearchBenchmarkSeries,
  artifacts: Array<{
    resultFileName: string;
    result: unknown;
    bundle: unknown;
  }>,
) {
  const trials = series.trials.flatMap((entry) => {
    const artifact = artifacts[entry.index - 1];
    return artifact &&
      verifyResearchBenchmarkArtifacts(artifact.result, artifact.bundle).valid
      ? [
          {
            result: artifact.result,
            bundle: artifact.bundle,
            resultPath: entry.resultFileName,
            ledgerPath: entry.ledgerFileName,
          } as ResearchBenchmarkArtifacts,
        ]
      : [];
  });
  if (trials.length !== series.trials.length) return undefined;
  try {
    return createResearchBenchmarkSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      status: series.status,
      trials,
    });
  } catch {
    return undefined;
  }
}

function metricSummary(values: number[]): ResearchBenchmarkMetricSummary {
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

function percentile(sorted: number[], percentileValue: number): number {
  return sorted[Math.floor((sorted.length - 1) * percentileValue)]!;
}

function trialVerificationInputs(trials: ResearchBenchmarkArtifacts[]) {
  return trials.map((trial) => ({
    resultFileName: path.basename(trial.resultPath),
    result: trial.result,
    bundle: trial.bundle,
  }));
}

export function researchBenchmarkSeriesFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-research-benchmark-series-${caseId}-${contentSha256.slice(0, 16)}.json`;
}
