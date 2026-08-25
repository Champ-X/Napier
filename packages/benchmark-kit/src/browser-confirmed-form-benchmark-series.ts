import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { BenchmarkCampaignRunner } from "./benchmark-campaign-runner.js";
import { verifyBrowserConfirmedFormBenchmarkArtifacts } from "./browser-confirmed-form-benchmark-contract.js";
import { browserConfirmedFormSeriesFileName } from "./browser-confirmed-form-benchmark-evidence.js";
import {
  runBrowserConfirmedFormBenchmark,
  type BrowserConfirmedFormBenchmarkDependencies,
  type RunBrowserConfirmedFormBenchmarkOptions,
} from "./browser-confirmed-form-benchmark.js";
import type {
  BrowserConfirmedFormBenchmarkArtifacts,
  BrowserConfirmedFormBenchmarkSeries,
  BrowserConfirmedFormBenchmarkSeriesArtifacts,
  BrowserConfirmedFormMetricSummary,
} from "./browser-confirmed-form-benchmark-types.js";
import { validBrowserConfirmedFormSeriesKeys } from "./browser-confirmed-form-benchmark-strict-shape.js";

export interface RunBrowserConfirmedFormBenchmarkSeriesOptions extends RunBrowserConfirmedFormBenchmarkOptions {
  trialCount: number;
}

export async function runBrowserConfirmedFormBenchmarkSeries(
  options: RunBrowserConfirmedFormBenchmarkSeriesOptions,
  dependencies?: BrowserConfirmedFormBenchmarkDependencies,
): Promise<BrowserConfirmedFormBenchmarkSeriesArtifacts> {
  const trials = await new BenchmarkCampaignRunner(
    options.outputDir,
  ).runTrials<BrowserConfirmedFormBenchmarkArtifacts>({
    trialCount: options.trialCount,
    minimum: 2,
    maximum: 10,
    invalidCountMessage: "Browser confirmed form trial count must be 2-10",
    beforeTrial: () => options.signal?.throwIfAborted(),
    runTrial: () => runBrowserConfirmedFormBenchmark(options, dependencies),
    shouldStop: () => options.signal?.aborted === true,
  });
  const series = createBrowserConfirmedFormBenchmarkSeries({
    generatedAt: (dependencies?.now() ?? new Date()).toISOString(),
    requestedTrialCount: options.trialCount,
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    browserConfirmedFormSeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyBrowserConfirmedFormBenchmarkSeries(
    series,
    trials,
  );
  if (!verification.valid) {
    throw new Error(
      `Browser confirmed form Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createBrowserConfirmedFormBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  trials: BrowserConfirmedFormBenchmarkArtifacts[];
}): BrowserConfirmedFormBenchmarkSeries {
  const first = input.trials[0]?.result;
  if (
    !first ||
    input.trials.length < 1 ||
    input.trials.length > input.requestedTrialCount ||
    input.requestedTrialCount < 2 ||
    input.requestedTrialCount > 10
  ) {
    throw new Error("Browser confirmed form Series trials are invalid");
  }
  const resultHashes = new Set<string>();
  const ledgerHashes = new Set<string>();
  const threadIds = new Set<string>();
  const runIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.model as unknown as JsonValue) !==
        canonicalJson(first.model as unknown as JsonValue) ||
      canonicalJson(trial.result.environment as unknown as JsonValue) !==
        canonicalJson(first.environment as unknown as JsonValue) ||
      resultHashes.has(trial.result.contentSha256) ||
      ledgerHashes.has(trial.bundle.contentSha256) ||
      threadIds.has(trial.result.run.threadId) ||
      runIds.has(trial.result.run.runId)
    ) {
      throw new Error("Browser confirmed form Series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    ledgerHashes.add(trial.bundle.contentSha256);
    threadIds.add(trial.result.run.threadId);
    runIds.add(trial.result.run.runId);
  }
  const entries = input.trials.map((trial, index) => ({
    index: index + 1,
    threadId: trial.result.run.threadId,
    runId: trial.result.run.runId,
    status: trial.result.status,
    resultFileName: path.basename(trial.resultPath),
    resultSha256: trial.result.contentSha256,
    ledgerFileName: path.basename(trial.ledgerPath),
    ledgerSha256: trial.bundle.contentSha256,
  }));
  const passedTrialCount = count(entries, "passed");
  const failedTrialCount = count(entries, "failed");
  const inconclusiveTrialCount = count(entries, "inconclusive");
  const scored = passedTrialCount + failedTrialCount;
  const content = {
    kind: "napier.browser-confirmed-form-benchmark-series" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first.caseId,
    caseSha256: first.caseSha256,
    model: structuredClone(first.model),
    environment: structuredClone(first.environment),
    status:
      entries.length === input.requestedTrialCount
        ? ("completed" as const)
        : ("cancelled" as const),
    requestedTrialCount: input.requestedTrialCount,
    completedTrialCount: entries.length,
    passedTrialCount,
    failedTrialCount,
    inconclusiveTrialCount,
    completionRate: entries.length / input.requestedTrialCount,
    passRate: scored === 0 ? null : passedTrialCount / scored,
    metrics: {
      firstConfirmationMs: summarize(
        input.trials.map((trial) => trial.result.execution.firstConfirmationMs),
      ),
      totalDurationMs: summarize(
        input.trials.map((trial) => trial.result.execution.totalDurationMs),
      ),
      costUsd: summarize(
        input.trials.map((trial) => trial.result.run.usage.costUsd),
      ),
    },
    trials: entries,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyBrowserConfirmedFormBenchmarkSeries(
  input: unknown,
  trialInputs: Array<{
    resultFileName?: string;
    result: BrowserConfirmedFormBenchmarkArtifacts["result"];
    bundle: BrowserConfirmedFormBenchmarkArtifacts["bundle"];
    resultPath?: string;
    ledgerPath?: string;
  }>,
): {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{ index: number; diagnostics: string[] }>;
} {
  if (!validSeriesShape(input)) {
    return {
      valid: false,
      diagnostics: ["series_shape_invalid"],
      seriesSha256: sha256(String(input)),
      trialDiagnostics: [],
    };
  }
  const series = input;
  const diagnostics: string[] = [];
  const { contentSha256, ...content } = series;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("series_hash_mismatch");
  }
  if (trialInputs.length !== series.trials.length) {
    diagnostics.push("series_artifact_count_mismatch");
  }
  const trials = trialInputs.map((trial) => ({
    resultFileName:
      trial.resultFileName ?? path.basename(trial.resultPath ?? ""),
    result: trial.result,
    bundle: trial.bundle,
    resultPath: trial.resultPath ?? trial.resultFileName ?? "",
    ledgerPath: trial.ledgerPath ?? trial.result.ledger.bundleFileName ?? "",
  }));
  const trialDiagnostics = series.trials.flatMap((entry) => {
    const trial = trials[entry.index - 1];
    const verification = trial
      ? verifyBrowserConfirmedFormBenchmarkArtifacts(trial.result, trial.bundle)
      : { valid: false, diagnostics: ["trial_artifact_missing"] };
    const issues = [...verification.diagnostics];
    if (
      !trial ||
      !verification.valid ||
      trial.resultFileName !== entry.resultFileName ||
      path.basename(trial.ledgerPath) !== entry.ledgerFileName ||
      trial.result.contentSha256 !== entry.resultSha256 ||
      trial.bundle.contentSha256 !== entry.ledgerSha256 ||
      trial.result.run.threadId !== entry.threadId ||
      trial.result.run.runId !== entry.runId ||
      trial.result.status !== entry.status
    ) {
      issues.push("trial_binding_mismatch");
    }
    return issues.length > 0
      ? [{ index: entry.index, diagnostics: issues }]
      : [];
  });
  if (trialDiagnostics.length > 0) diagnostics.push("series_trial_invalid");
  if (diagnostics.length === 0 && trials.length === series.trials.length) {
    try {
      const recreated = createBrowserConfirmedFormBenchmarkSeries({
        generatedAt: series.generatedAt,
        requestedTrialCount: series.requestedTrialCount,
        trials,
      });
      if (canonicalJson(recreated) !== canonicalJson(series)) {
        diagnostics.push("series_aggregate_mismatch");
      }
    } catch {
      diagnostics.push("series_aggregate_mismatch");
    }
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    seriesSha256: series.contentSha256,
    trialDiagnostics,
  };
}

export function browserConfirmedFormSeriesArtifactReferences(input: unknown) {
  if (!validSeriesShape(input)) {
    throw new Error("Browser confirmed form Series is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

function summarize(values: number[]): BrowserConfirmedFormMetricSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    total,
    min: sorted[0]!,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
    mean: total / sorted.length,
  };
}

function percentile(sorted: number[], rate: number): number {
  return sorted[Math.ceil(sorted.length * rate) - 1]!;
}

function count(
  entries: BrowserConfirmedFormBenchmarkSeries["trials"],
  status: BrowserConfirmedFormBenchmarkSeries["trials"][number]["status"],
): number {
  return entries.filter((entry) => entry.status === status).length;
}

function validSeriesShape(
  value: unknown,
): value is BrowserConfirmedFormBenchmarkSeries {
  if (!record(value) || !validBrowserConfirmedFormSeriesKeys(value)) {
    return false;
  }
  const series = value as unknown as BrowserConfirmedFormBenchmarkSeries;
  return (
    validSeriesHeader(series) &&
    validSeriesCounts(series) &&
    validMetrics(series.metrics) &&
    Array.isArray(series.trials) &&
    series.trials.length === series.completedTrialCount &&
    series.trials.every(validTrial)
  );
}

function validSeriesHeader(
  series: BrowserConfirmedFormBenchmarkSeries,
): boolean {
  return (
    series.kind === "napier.browser-confirmed-form-benchmark-series" &&
    series.schemaVersion === 1 &&
    isoDate(series.generatedAt) &&
    resourceId(series.caseId) &&
    digest(series.caseSha256) &&
    digest(series.contentSha256) &&
    record(series.model) &&
    record(series.environment) &&
    boundedInteger(series.requestedTrialCount, 2, 10)
  );
}

function validSeriesCounts(
  series: BrowserConfirmedFormBenchmarkSeries,
): boolean {
  const total =
    series.passedTrialCount +
    series.failedTrialCount +
    series.inconclusiveTrialCount;
  return (
    (series.status === "completed" || series.status === "cancelled") &&
    boundedInteger(series.completedTrialCount, 1, 10) &&
    boundedInteger(series.passedTrialCount, 0, 10) &&
    boundedInteger(series.failedTrialCount, 0, 10) &&
    boundedInteger(series.inconclusiveTrialCount, 0, 10) &&
    total === series.completedTrialCount &&
    series.completedTrialCount <= series.requestedTrialCount &&
    (series.status === "completed"
      ? series.completedTrialCount === series.requestedTrialCount
      : series.completedTrialCount < series.requestedTrialCount) &&
    finiteRate(series.completionRate) &&
    (series.passRate === null || finiteRate(series.passRate))
  );
}

function validMetrics(value: unknown): boolean {
  return (
    record(value) &&
    validMetric(value["firstConfirmationMs"]) &&
    validMetric(value["totalDurationMs"]) &&
    validMetric(value["costUsd"])
  );
}

function validMetric(value: unknown): boolean {
  return (
    record(value) &&
    ["total", "min", "p50", "p95", "max", "mean"].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        Number(value[key]) >= 0,
    )
  );
}

function validTrial(value: unknown): boolean {
  return (
    record(value) &&
    boundedInteger(value["index"], 1, 10) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    ["passed", "failed", "inconclusive"].includes(String(value["status"])) &&
    boundedText(value["resultFileName"], 1, 400) &&
    digest(value["resultSha256"]) &&
    boundedText(value["ledgerFileName"], 1, 400) &&
    digest(value["ledgerSha256"])
  );
}

function finiteRate(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
