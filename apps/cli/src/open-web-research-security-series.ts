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
  OpenWebResearchSecuritySeries,
  OpenWebResearchSecuritySeriesArtifacts,
  OpenWebResearchSecuritySeriesVerification,
} from "./open-web-research-benchmark-types.js";
import { verifyOpenWebResearchBenchmarkAgainstCase } from "./open-web-research-benchmark-verifier.js";
import { validOpenWebResearchSecuritySeriesShape } from "./open-web-research-security-series-shape.js";

export interface RunOpenWebResearchSecuritySeriesOptions extends RunOpenWebResearchBenchmarkOptions {
  trialCount: number;
}

export async function runOpenWebResearchSecuritySeries(
  options: RunOpenWebResearchSecuritySeriesOptions,
  dependencies?: OpenWebResearchBenchmarkDependencies,
): Promise<OpenWebResearchSecuritySeriesArtifacts> {
  validateTrialCount(options.trialCount);
  const loaded = await loadOpenWebResearchBenchmarkCase(options.caseRoot);
  if (loaded.benchmarkCase.schemaVersion !== 2 || !loaded.expected.security) {
    throw new Error(
      "Open-web Research Security Series requires a schema-2 security case",
    );
  }
  const trials: OpenWebResearchBenchmarkArtifacts[] = [];
  for (let index = 0; index < options.trialCount; index += 1) {
    options.signal?.throwIfAborted();
    trials.push(await runOpenWebResearchBenchmark(options, dependencies));
    if (options.signal?.aborted) break;
  }
  const now = dependencies?.now ?? (() => new Date());
  const series = createOpenWebResearchSecuritySeries({
    generatedAt: now().toISOString(),
    requestedTrialCount: options.trialCount,
    status: trials.length === options.trialCount ? "completed" : "cancelled",
    trials,
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    openWebResearchSecuritySeriesFileName(series.caseId, series.contentSha256),
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyOpenWebResearchSecuritySeries(
    series,
    trialVerificationInputs(trials),
    loaded.benchmarkCase,
    loaded.expected,
  );
  if (!verification.valid) {
    throw new Error(
      `Open-web Research Security Series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createOpenWebResearchSecuritySeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  status: OpenWebResearchSecuritySeries["status"];
  trials: OpenWebResearchBenchmarkArtifacts[];
}): OpenWebResearchSecuritySeries {
  const first = input.trials[0]?.result;
  validateSeriesInput(input, first);
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  for (const trial of input.trials) {
    if (!consistentTrial(first!, trial, resultHashes, threadIds)) {
      throw new Error(
        "Open-web Research Security Series trials are inconsistent",
      );
    }
    resultHashes.add(trial.result.contentSha256);
    threadIds.add(trial.result.run.threadId);
  }
  const trialEntries = input.trials.map((trial, offset) =>
    trialEntry(trial, offset + 1),
  );
  const passedTrialCount = statusCount(trialEntries, "passed");
  const content = {
    kind: "napier.open-web-research-security-series" as const,
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
    promptInjectionLeakTrialCount: booleanCount(
      trialEntries,
      "promptInjectionLeakDetected",
    ),
    forbiddenToolAttemptTrialCount: booleanCount(
      trialEntries,
      "forbiddenToolAttemptDetected",
    ),
    exactFinalResponseTrialCount: booleanCount(
      trialEntries,
      "finalResponseExact",
    ),
    replayValidTrialCount: booleanCount(trialEntries, "replayValid"),
    credentialLeakTrialCount: booleanCount(
      trialEntries,
      "credentialLeakDetected",
    ),
    completionRate: trialEntries.length / input.requestedTrialCount,
    passRate:
      trialEntries.length === 0 ? null : passedTrialCount / trialEntries.length,
    exactFinalResponseRate:
      trialEntries.length === 0
        ? null
        : booleanCount(trialEntries, "finalResponseExact") /
          trialEntries.length,
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
    resultSetSha256: sha256(
      canonicalJson(trialEntries.map((trial) => trial.resultSha256)),
    ),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyOpenWebResearchSecuritySeries(
  input: unknown,
  artifacts: Array<{ resultFileName: string; result: unknown }>,
  benchmarkCase: Parameters<
    typeof verifyOpenWebResearchBenchmarkAgainstCase
  >[1],
  expected: Parameters<typeof verifyOpenWebResearchBenchmarkAgainstCase>[2],
): OpenWebResearchSecuritySeriesVerification {
  if (!validOpenWebResearchSecuritySeriesShape(input)) {
    return invalidSeries(input);
  }
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
    if (!trialBindingMatches(trial, artifact, verification.resultSha256)) {
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

export function openWebResearchSecuritySeriesArtifactReferences(
  input: unknown,
) {
  if (!validOpenWebResearchSecuritySeriesShape(input)) {
    throw new Error("Open-web Research Security Series shape is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
  }));
}

export function openWebResearchSecuritySeriesFileName(
  caseId: string,
  contentSha256: string,
): string {
  return `napier-open-web-research-security-series-${caseId}-${contentSha256.slice(0, 16)}.json`;
}

function validateTrialCount(trialCount: number): void {
  if (!Number.isSafeInteger(trialCount) || trialCount < 2 || trialCount > 10) {
    throw new Error(
      "Open-web Research Security Series trial count must be 2-10",
    );
  }
}

function validateSeriesInput(
  input: {
    requestedTrialCount: number;
    status: OpenWebResearchSecuritySeries["status"];
    trials: OpenWebResearchBenchmarkArtifacts[];
  },
  first: OpenWebResearchBenchmarkResult | undefined,
): void {
  validateTrialCount(input.requestedTrialCount);
  if (
    !first?.security ||
    first.schemaVersion !== 2 ||
    input.trials.length > input.requestedTrialCount ||
    (input.status === "completed" &&
      input.trials.length !== input.requestedTrialCount) ||
    (input.status === "cancelled" &&
      input.trials.length >= input.requestedTrialCount)
  ) {
    throw new Error("Open-web Research Security Series trials are invalid");
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
    result.schemaVersion === 2 &&
    result.security !== undefined &&
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
): OpenWebResearchSecuritySeries["trials"][number] {
  const result = trial.result;
  const security = result.security!;
  return {
    index,
    threadId: result.run.threadId,
    status: result.status,
    resultFileName: path.basename(trial.resultPath),
    resultSha256: result.contentSha256,
    assistantOutputSha256: security.assistantOutputSha256,
    actualAttemptedToolSequenceSha256:
      security.actualAttemptedToolSequenceSha256,
    finalResponseExact: security.finalResponseExact,
    promptInjectionLeakDetected: security.promptInjectionLeakDetected,
    forbiddenToolAttemptDetected: security.forbiddenToolAttemptDetected,
    replayValid: result.replayValid,
    credentialLeakDetected: result.credentialLeakDetected,
  };
}

function trialBindingMatches(
  trial: OpenWebResearchSecuritySeries["trials"][number],
  artifact: { resultFileName: string; result: unknown } | undefined,
  resultSha256: string,
): boolean {
  const result = artifact?.result as OpenWebResearchBenchmarkResult | undefined;
  const security = result?.security;
  return Boolean(
    artifact &&
    result &&
    security &&
    artifact.resultFileName === trial.resultFileName &&
    resultSha256 === trial.resultSha256 &&
    result.run.threadId === trial.threadId &&
    result.status === trial.status &&
    security.assistantOutputSha256 === trial.assistantOutputSha256 &&
    security.actualAttemptedToolSequenceSha256 ===
      trial.actualAttemptedToolSequenceSha256 &&
    security.finalResponseExact === trial.finalResponseExact &&
    security.promptInjectionLeakDetected ===
      trial.promptInjectionLeakDetected &&
    security.forbiddenToolAttemptDetected ===
      trial.forbiddenToolAttemptDetected &&
    result.replayValid === trial.replayValid &&
    result.credentialLeakDetected === trial.credentialLeakDetected,
  );
}

function recreateSeries(
  series: OpenWebResearchSecuritySeries,
  artifacts: Array<{ resultFileName: string; result: unknown }>,
  diagnostics: Array<{ index: number; diagnostics: string[] }>,
) {
  if (diagnostics.some((trial) => trial.diagnostics.length > 0)) {
    return undefined;
  }
  const trials = artifacts.map((artifact) => ({
    result: artifact.result as OpenWebResearchBenchmarkResult,
    resultPath: artifact.resultFileName,
  }));
  try {
    return createOpenWebResearchSecuritySeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      status: series.status,
      trials,
    });
  } catch {
    return undefined;
  }
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
  trials: OpenWebResearchSecuritySeries["trials"],
  status: OpenWebResearchBenchmarkResult["status"],
): number {
  return trials.filter((trial) => trial.status === status).length;
}

function booleanCount(
  trials: OpenWebResearchSecuritySeries["trials"],
  key:
    | "promptInjectionLeakDetected"
    | "forbiddenToolAttemptDetected"
    | "finalResponseExact"
    | "replayValid"
    | "credentialLeakDetected",
): number {
  return trials.filter((trial) => trial[key]).length;
}

function invalidSeries(
  input: unknown,
): OpenWebResearchSecuritySeriesVerification {
  return {
    valid: false,
    diagnostics: ["series_shape_invalid"],
    seriesSha256: sha256(String(input)),
    trialDiagnostics: [],
  };
}
