import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { BenchmarkCampaignRunner } from "./benchmark-campaign-runner.js";
import {
  uxBenchmarkLedgerFileName,
  uxBenchmarkResultFileName,
  uxBenchmarkSeriesFileName,
  verifyUxBenchmarkArtifacts,
} from "./ux-benchmark-contract.js";
import { validUxBenchmarkSeriesShape } from "./ux-benchmark-series-shape.js";
import {
  runUxBenchmark,
  type RunUxBenchmarkOptions,
  type UxBenchmarkDependencies,
} from "./ux-benchmark.js";
import type {
  UxBenchmarkArtifacts,
  UxBenchmarkMetricSummary,
  UxBenchmarkResult,
  UxBenchmarkSeries,
  UxBenchmarkSeriesArtifacts,
  UxBenchmarkSeriesVerification,
} from "./ux-benchmark-types.js";

export interface RunUxBenchmarkSeriesOptions extends RunUxBenchmarkOptions {
  trialCount: number;
}

export async function runUxBenchmarkSeries(
  options: RunUxBenchmarkSeriesOptions,
  dependencies?: UxBenchmarkDependencies,
): Promise<UxBenchmarkSeriesArtifacts> {
  const trials = await new BenchmarkCampaignRunner(
    options.outputDir,
  ).runTrials<UxBenchmarkArtifacts>({
    trialCount: options.trialCount,
    minimum: 2,
    maximum: 10,
    invalidCountMessage: "UX benchmark trial count must be 2-10",
    beforeTrial: () => options.signal?.throwIfAborted(),
    runTrial: () => runUxBenchmark(options, dependencies),
    shouldStop: () => options.signal?.aborted === true,
  });
  const now = dependencies?.now ?? (() => new Date());
  const series = createUxBenchmarkSeries({
    generatedAt: now().toISOString(),
    requestedTrialCount: options.trialCount,
    status: trials.length === options.trialCount ? "completed" : "cancelled",
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    uxBenchmarkSeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyUxBenchmarkSeries(
    series,
    trialVerificationInputs(trials),
  );
  if (!verification.valid) {
    throw new Error(
      `UX benchmark Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createUxBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  status: UxBenchmarkSeries["status"];
  trials: UxBenchmarkArtifacts[];
}): UxBenchmarkSeries {
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
    throw new Error("UX benchmark Series trial count is invalid");
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
        uxBenchmarkResultFileName(
          trial.result.caseId,
          trial.result.contentSha256,
        ) ||
      ledgerFileName !==
        uxBenchmarkLedgerFileName(
          trial.result.caseId,
          trial.bundle.contentSha256,
        ) ||
      trial.result.ledger.bundleFileName !== ledgerFileName ||
      trial.result.ledger.bundleSha256 !== trial.bundle.contentSha256 ||
      resultHashes.has(trial.result.contentSha256) ||
      ledgerHashes.has(trial.bundle.contentSha256) ||
      threadIds.has(trial.result.run.threadId)
    ) {
      throw new Error("UX benchmark Series trials are inconsistent");
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
    kind: "napier.ux-benchmark-series" as const,
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
      firstEventMs: metricSummary(
        input.trials.map((trial) => trial.result.evaluation.firstEventMs),
      ),
      totalDurationMs: metricSummary(
        input.trials.map((trial) => trial.result.evaluation.totalDurationMs),
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

export function verifyUxBenchmarkSeries(
  input: unknown,
  artifacts: Array<{
    resultFileName: string;
    result: unknown;
    bundle: unknown;
  }>,
): UxBenchmarkSeriesVerification {
  if (!validUxBenchmarkSeriesShape(input)) {
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
      ? verifyUxBenchmarkArtifacts(artifact.result, artifact.bundle)
      : {
          valid: false,
          diagnostics: ["trial_artifact_missing"],
          resultSha256: "",
        };
    const issues = [...verification.diagnostics];
    const result = artifact?.result as UxBenchmarkResult | undefined;
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
      ? createSeriesFromVerified(series, artifacts)
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

export function uxBenchmarkSeriesArtifactReferences(input: unknown) {
  if (!validUxBenchmarkSeriesShape(input)) {
    throw new Error("UX benchmark Series shape is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

function createSeriesFromVerified(
  series: UxBenchmarkSeries,
  artifacts: Array<{
    resultFileName: string;
    result: unknown;
    bundle: unknown;
  }>,
) {
  const trials = series.trials.flatMap((entry) => {
    const artifact = artifacts[entry.index - 1];
    return artifact &&
      verifyUxBenchmarkArtifacts(artifact.result, artifact.bundle).valid
      ? [
          {
            result: artifact.result,
            bundle: artifact.bundle,
            resultPath: entry.resultFileName,
            ledgerPath: entry.ledgerFileName,
          } as UxBenchmarkArtifacts,
        ]
      : [];
  });
  if (trials.length !== series.trials.length) return undefined;
  try {
    return createUxBenchmarkSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      status: series.status,
      trials,
    });
  } catch {
    return undefined;
  }
}

function metricSummary(values: number[]): UxBenchmarkMetricSummary {
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

function trialVerificationInputs(trials: UxBenchmarkArtifacts[]) {
  return trials.map((trial) => ({
    resultFileName: path.basename(trial.resultPath),
    result: trial.result,
    bundle: trial.bundle,
  }));
}
