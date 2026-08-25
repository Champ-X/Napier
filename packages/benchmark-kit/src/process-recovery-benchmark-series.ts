import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { verifyProcessRecoveryBenchmarkArtifacts } from "./process-recovery-benchmark-contract.js";
import {
  runProcessRecoveryBenchmark,
  type ProcessRecoveryBenchmarkDependencies,
  type RunProcessRecoveryBenchmarkOptions,
} from "./process-recovery-benchmark.js";
import type {
  ProcessRecoveryBenchmarkArtifacts,
  ProcessRecoveryBenchmarkSeries,
  ProcessRecoveryBenchmarkSeriesArtifacts,
  ProcessRecoveryMetricSummary,
} from "./process-recovery-benchmark-types.js";

export interface RunProcessRecoveryBenchmarkSeriesOptions extends RunProcessRecoveryBenchmarkOptions {
  trialCount: number;
}

export async function runProcessRecoveryBenchmarkSeries(
  options: RunProcessRecoveryBenchmarkSeriesOptions,
  dependencies?: ProcessRecoveryBenchmarkDependencies,
): Promise<ProcessRecoveryBenchmarkSeriesArtifacts> {
  if (
    !Number.isSafeInteger(options.trialCount) ||
    options.trialCount < 2 ||
    options.trialCount > 20
  ) {
    throw new Error("Process recovery benchmark trial count must be 2-20");
  }
  const trials: ProcessRecoveryBenchmarkArtifacts[] = [];
  for (let index = 0; index < options.trialCount; index += 1) {
    options.signal?.throwIfAborted();
    trials.push(await runProcessRecoveryBenchmark(options, dependencies));
    if (options.signal?.aborted) break;
  }
  const series = createProcessRecoveryBenchmarkSeries({
    generatedAt: (dependencies?.now() ?? new Date()).toISOString(),
    requestedTrialCount: options.trialCount,
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    processRecoverySeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyProcessRecoveryBenchmarkSeries(series, trials);
  if (!verification.valid) {
    throw new Error(
      `Process recovery Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createProcessRecoveryBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  trials: ProcessRecoveryBenchmarkArtifacts[];
}): ProcessRecoveryBenchmarkSeries {
  const first = input.trials[0]?.result;
  if (
    !first ||
    input.trials.length < 1 ||
    input.trials.length > input.requestedTrialCount
  ) {
    throw new Error("Process recovery Series trials are invalid");
  }
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  const processIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.executor as unknown as JsonValue) !==
        canonicalJson(first.executor as unknown as JsonValue) ||
      resultHashes.has(trial.result.contentSha256) ||
      threadIds.has(trial.result.run.threadId) ||
      processIds.has(trial.result.run.processId)
    ) {
      throw new Error("Process recovery Series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    threadIds.add(trial.result.run.threadId);
    processIds.add(trial.result.run.processId);
  }
  const entries = input.trials.map((trial, index) => ({
    index: index + 1,
    threadId: trial.result.run.threadId,
    processId: trial.result.run.processId,
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
    kind: "napier.process-recovery-benchmark-series" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first.caseId,
    caseSha256: first.caseSha256,
    executor: structuredClone(first.executor),
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
    successRate: passedTrialCount / entries.length,
    passRate: scored === 0 ? null : passedTrialCount / scored,
    metrics: {
      durationMs: summarize(
        input.trials.map((trial) => trial.result.run.durationMs),
      ),
      processEventCount: summarize(
        input.trials.map((trial) => trial.result.evaluation.processEventCount),
      ),
    },
    trials: entries,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function verifyProcessRecoveryBenchmarkSeries(
  input: unknown,
  trialInputs: Array<{
    resultFileName?: string;
    result: ProcessRecoveryBenchmarkArtifacts["result"];
    bundle: ProcessRecoveryBenchmarkArtifacts["bundle"];
    resultPath?: string;
    ledgerPath?: string;
  }>,
): {
  valid: boolean;
  diagnostics: string[];
  seriesSha256: string;
  trialDiagnostics: Array<{ index: number; diagnostics: string[] }>;
} {
  if (!record(input)) {
    return {
      valid: false,
      diagnostics: ["series_shape_invalid"],
      seriesSha256: sha256(String(input)),
      trialDiagnostics: [],
    };
  }
  const series = input as unknown as ProcessRecoveryBenchmarkSeries;
  const diagnostics: string[] = [];
  if (
    !validSeriesIdentity(series) ||
    sha256(canonicalJson(withoutHash(series) as unknown as JsonValue)) !==
      series.contentSha256
  ) {
    diagnostics.push("series_shape_invalid");
  }
  if (!validSeriesIdentity(series)) {
    return {
      valid: false,
      diagnostics,
      seriesSha256: digest(series.contentSha256)
        ? series.contentSha256
        : sha256(String(input)),
      trialDiagnostics: [],
    };
  }
  const trials = trialInputs.map((trial) => ({
    resultFileName:
      trial.resultFileName ??
      path.basename(trial.resultPath ?? "missing-result.json"),
    result: trial.result,
    bundle: trial.bundle,
    resultPath:
      trial.resultPath ?? trial.resultFileName ?? "missing-result.json",
    ledgerPath: trial.ledgerPath ?? trial.result.ledger.bundleFileName,
  }));
  if (trials.length !== series.trials.length) {
    diagnostics.push("series_artifact_count_mismatch");
  }
  const trialDiagnostics = series.trials.flatMap((entry) => {
    const trial = trials[entry.index - 1];
    const verification = trial
      ? verifyProcessRecoveryBenchmarkArtifacts(trial.result, trial.bundle)
      : { valid: false, diagnostics: ["trial_artifact_missing"] };
    const issues = [...verification.diagnostics];
    if (
      !trial ||
      !verification.valid ||
      trial.resultFileName !== entry.resultFileName ||
      trial.result.contentSha256 !== entry.resultSha256 ||
      trial.bundle.contentSha256 !== entry.ledgerSha256 ||
      trial.result.run.threadId !== entry.threadId ||
      trial.result.run.processId !== entry.processId ||
      trial.result.status !== entry.status ||
      path.basename(trial.ledgerPath) !== entry.ledgerFileName ||
      trial.result.ledger.bundleFileName !== entry.ledgerFileName ||
      trial.result.ledger.bundleSha256 !== entry.ledgerSha256
    ) {
      issues.push("trial_binding_mismatch");
    }
    return issues.length > 0
      ? [{ index: entry.index, diagnostics: issues }]
      : [];
  });
  if (trialDiagnostics.length > 0) diagnostics.push("series_trial_invalid");
  if (diagnostics.length === 0 && trials.length === series.trials.length) {
    const recreated = createProcessRecoveryBenchmarkSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      trials,
    });
    if (canonicalJson(recreated) !== canonicalJson(series)) {
      diagnostics.push("series_aggregate_mismatch");
    }
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    seriesSha256: digest(series.contentSha256)
      ? series.contentSha256
      : sha256(String(input)),
    trialDiagnostics,
  };
}

export function processRecoverySeriesArtifactReferences(input: unknown) {
  if (!record(input)) throw new Error("Process recovery Series is invalid");
  const series = input as unknown as ProcessRecoveryBenchmarkSeries;
  if (!validSeriesIdentity(series)) {
    throw new Error("Process recovery Series is invalid");
  }
  return series.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

export function processRecoverySeriesFileName(
  caseId: string,
  digestValue: string,
): string {
  return `napier-process-recovery-benchmark-series-${caseId}-${digestValue.slice(0, 16)}.json`;
}

function summarize(values: number[]): ProcessRecoveryMetricSummary {
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
  entries: ProcessRecoveryBenchmarkSeries["trials"],
  status: ProcessRecoveryBenchmarkSeries["trials"][number]["status"],
): number {
  return entries.filter((entry) => entry.status === status).length;
}

function validSeriesIdentity(series: ProcessRecoveryBenchmarkSeries): boolean {
  return (
    validSeriesHeader(series) &&
    validSeriesExecutor(series.executor) &&
    validSeriesEnvironment(series.environment) &&
    validSeriesCounts(series) &&
    validSeriesMetrics(series.metrics) &&
    validSeriesTrials(series.trials)
  );
}

function validSeriesHeader(series: ProcessRecoveryBenchmarkSeries): boolean {
  return (
    series.kind === "napier.process-recovery-benchmark-series" &&
    series.schemaVersion === 1 &&
    isoDate(series.generatedAt) &&
    resourceId(series.caseId) &&
    digest(series.contentSha256) &&
    digest(series.caseSha256) &&
    Number.isSafeInteger(series.requestedTrialCount) &&
    series.requestedTrialCount >= 2 &&
    series.requestedTrialCount <= 20
  );
}

function validSeriesExecutor(value: unknown): boolean {
  return (
    record(value) &&
    value["kind"] === "napier" &&
    value["capability"] === "workspace_process" &&
    boundedText(value["sandboxId"], 1, 200) &&
    (value["sandboxBoundary"] === "platform" ||
      value["sandboxBoundary"] === "trusted_outer_test")
  );
}

function validSeriesEnvironment(value: unknown): boolean {
  return (
    record(value) &&
    boundedText(value["nodeVersion"], 1, 80) &&
    boundedText(value["platform"], 1, 40) &&
    boundedText(value["arch"], 1, 40) &&
    boundedText(value["cliVersion"], 1, 40)
  );
}

function validSeriesCounts(series: ProcessRecoveryBenchmarkSeries): boolean {
  const total =
    series.passedTrialCount +
    series.failedTrialCount +
    series.inconclusiveTrialCount;
  return (
    (series.status === "completed" || series.status === "cancelled") &&
    boundedInteger(series.completedTrialCount, 1, 20) &&
    boundedInteger(series.passedTrialCount, 0, 20) &&
    boundedInteger(series.failedTrialCount, 0, 20) &&
    boundedInteger(series.inconclusiveTrialCount, 0, 20) &&
    total === series.completedTrialCount &&
    series.completedTrialCount <= series.requestedTrialCount &&
    series.trials.length === series.completedTrialCount &&
    (series.status === "completed"
      ? series.completedTrialCount === series.requestedTrialCount
      : series.completedTrialCount < series.requestedTrialCount) &&
    finiteRate(series.successRate) &&
    (series.passRate === null || finiteRate(series.passRate))
  );
}

function validSeriesMetrics(value: unknown): boolean {
  return (
    record(value) &&
    validMetricSummary(value["durationMs"]) &&
    validMetricSummary(value["processEventCount"])
  );
}

function validMetricSummary(value: unknown): boolean {
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

function validSeriesTrials(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 20 &&
    value.every((trial, index) => validSeriesTrial(trial, index + 1))
  );
}

function validSeriesTrial(value: unknown, expectedIndex: number): boolean {
  return (
    record(value) &&
    value["index"] === expectedIndex &&
    resourceId(value["threadId"]) &&
    processId(value["processId"]) &&
    (value["status"] === "passed" ||
      value["status"] === "failed" ||
      value["status"] === "inconclusive") &&
    artifactFileName(value["resultFileName"]) &&
    digest(value["resultSha256"]) &&
    artifactFileName(value["ledgerFileName"]) &&
    digest(value["ledgerSha256"])
  );
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function processId(value: unknown): value is string {
  return typeof value === "string" && /^process_[a-z0-9]{8,80}$/u.test(value);
}

function artifactFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 400 &&
    /^[A-Za-z0-9._-]+$/u.test(value)
  );
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

function finiteRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
