import path from "node:path";

import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { verifyGoalNoProgressBenchmarkArtifacts } from "./goal-no-progress-benchmark-contract.js";
import {
  runGoalNoProgressBenchmark,
  type GoalNoProgressBenchmarkDependencies,
  type RunGoalNoProgressBenchmarkOptions,
} from "./goal-no-progress-benchmark.js";
import type {
  GoalNoProgressBenchmarkArtifacts,
  GoalNoProgressBenchmarkSeries,
  GoalNoProgressBenchmarkSeriesArtifacts,
  GoalNoProgressMetricSummary,
} from "./goal-no-progress-benchmark-types.js";

export interface RunGoalNoProgressBenchmarkSeriesOptions extends RunGoalNoProgressBenchmarkOptions {
  trialCount: number;
}

export async function runGoalNoProgressBenchmarkSeries(
  options: RunGoalNoProgressBenchmarkSeriesOptions,
  dependencies?: GoalNoProgressBenchmarkDependencies,
): Promise<GoalNoProgressBenchmarkSeriesArtifacts> {
  if (
    !Number.isSafeInteger(options.trialCount) ||
    options.trialCount < 2 ||
    options.trialCount > 10
  ) {
    throw new Error("Goal no-progress benchmark trial count must be 2-10");
  }
  const trials: GoalNoProgressBenchmarkArtifacts[] = [];
  for (let index = 0; index < options.trialCount; index += 1) {
    options.signal?.throwIfAborted();
    trials.push(await runGoalNoProgressBenchmark(options, dependencies));
    if (options.signal?.aborted) break;
  }
  const series = createGoalNoProgressBenchmarkSeries({
    generatedAt: (dependencies?.now() ?? new Date()).toISOString(),
    requestedTrialCount: options.trialCount,
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    goalNoProgressSeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyGoalNoProgressBenchmarkSeries(series, trials);
  if (!verification.valid) {
    throw new Error(
      `Goal no-progress Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createGoalNoProgressBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  trials: GoalNoProgressBenchmarkArtifacts[];
}): GoalNoProgressBenchmarkSeries {
  const first = input.trials[0]?.result;
  if (
    !first ||
    input.trials.length < 1 ||
    input.trials.length > input.requestedTrialCount
  ) {
    throw new Error("Goal no-progress Series trials are invalid");
  }
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.model as unknown as JsonValue) !==
        canonicalJson(first.model as unknown as JsonValue) ||
      resultHashes.has(trial.result.contentSha256) ||
      threadIds.has(trial.result.run.threadId)
    ) {
      throw new Error("Goal no-progress Series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    threadIds.add(trial.result.run.threadId);
  }
  const entries = input.trials.map((trial, index) => ({
    index: index + 1,
    threadId: trial.result.run.threadId,
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
    kind: "napier.goal-no-progress-benchmark-series" as const,
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
    successRate: passedTrialCount / entries.length,
    passRate: scored === 0 ? null : passedTrialCount / scored,
    metrics: {
      durationMs: summarize(
        input.trials.map((trial) => trial.result.run.durationMs),
      ),
      costUsd: summarize(
        input.trials.map((trial) => trial.result.run.usage.costUsd),
      ),
      inputTokens: summarize(
        input.trials.map((trial) => trial.result.run.usage.inputTokens),
      ),
      outputTokens: summarize(
        input.trials.map((trial) => trial.result.run.usage.outputTokens),
      ),
      modelResponseCount: summarize(
        input.trials.map((trial) => trial.result.evaluation.modelResponseCount),
      ),
    },
    trials: entries,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function verifyGoalNoProgressBenchmarkSeries(
  input: unknown,
  trialInputs: Array<{
    resultFileName?: string;
    result: GoalNoProgressBenchmarkArtifacts["result"];
    bundle: GoalNoProgressBenchmarkArtifacts["bundle"];
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
  const series = input as unknown as GoalNoProgressBenchmarkSeries;
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
      ? verifyGoalNoProgressBenchmarkArtifacts(trial.result, trial.bundle)
      : { valid: false, diagnostics: ["trial_artifact_missing"] };
    const issues = [...verification.diagnostics];
    if (
      !trial ||
      !verification.valid ||
      trial.resultFileName !== entry.resultFileName ||
      trial.result.contentSha256 !== entry.resultSha256 ||
      trial.bundle.contentSha256 !== entry.ledgerSha256 ||
      trial.result.run.threadId !== entry.threadId ||
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
    const recreated = createGoalNoProgressBenchmarkSeries({
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

export function goalNoProgressSeriesArtifactReferences(input: unknown) {
  if (!record(input)) {
    throw new Error("Goal no-progress Series is invalid");
  }
  const series = input as unknown as GoalNoProgressBenchmarkSeries;
  if (
    series.kind !== "napier.goal-no-progress-benchmark-series" ||
    !Array.isArray(series.trials)
  ) {
    throw new Error("Goal no-progress Series is invalid");
  }
  return series.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

export function goalNoProgressSeriesFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-goal-no-progress-benchmark-series-${caseId}-${digest.slice(0, 16)}.json`;
}

function summarize(values: number[]): GoalNoProgressMetricSummary {
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
  entries: GoalNoProgressBenchmarkSeries["trials"],
  status: GoalNoProgressBenchmarkSeries["trials"][number]["status"],
): number {
  return entries.filter((entry) => entry.status === status).length;
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

function validSeriesIdentity(value: GoalNoProgressBenchmarkSeries): boolean {
  return (
    value.kind === "napier.goal-no-progress-benchmark-series" &&
    value.schemaVersion === 1 &&
    typeof value.generatedAt === "string" &&
    typeof value.caseId === "string" &&
    digest(value.caseSha256) &&
    digest(value.contentSha256) &&
    Array.isArray(value.trials) &&
    value.trials.every(
      (trial, index) =>
        trial.index === index + 1 &&
        typeof trial.threadId === "string" &&
        typeof trial.resultFileName === "string" &&
        digest(trial.resultSha256) &&
        typeof trial.ledgerFileName === "string" &&
        digest(trial.ledgerSha256),
    )
  );
}
