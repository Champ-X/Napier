import path from "node:path";

import { canonicalJson, sha256 } from "@napier/runtime/core";

import { writeBenchmarkCasFile } from "./benchmark-artifact-file.js";
import { BenchmarkCampaignRunner } from "./benchmark-campaign-runner.js";
import {
  verifyWorkflowBenchmarkArtifacts,
  workflowBenchmarkLedgerFileName,
  workflowBenchmarkResultFileName,
} from "./workflow-benchmark-contract.js";
import {
  runWorkflowBenchmark,
  type RunWorkflowBenchmarkOptions,
  type WorkflowBenchmarkDependencies,
} from "./workflow-benchmark.js";
import {
  createWorkflowBenchmarkSeriesMetrics,
  validWorkflowBenchmarkSeriesMetrics,
} from "./workflow-benchmark-series-metrics.js";
import type {
  WorkflowBenchmarkArtifacts,
  WorkflowBenchmarkResult,
  WorkflowBenchmarkSeries,
  WorkflowBenchmarkSeriesVerification,
} from "./workflow-benchmark-types.js";

const SERIES_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 model environment status requestedTrialCount completedTrialCount scoredTrialCount passedTrialCount failedTrialCount inconclusiveTrialCount completionRate passRate metrics trials contentSha256",
);
const TRIAL_KEYS = keySet(
  "index threadId status resultFileName resultSha256 ledgerFileName ledgerSha256",
);

export interface RunWorkflowBenchmarkSeriesOptions extends RunWorkflowBenchmarkOptions {
  trialCount: number;
}

export interface WorkflowBenchmarkSeriesArtifacts {
  series: WorkflowBenchmarkSeries;
  seriesPath: string;
  trials: WorkflowBenchmarkArtifacts[];
}

export async function runWorkflowBenchmarkSeries(
  options: RunWorkflowBenchmarkSeriesOptions,
  dependencies?: WorkflowBenchmarkDependencies,
): Promise<WorkflowBenchmarkSeriesArtifacts> {
  const { trialCount, ...benchmarkOptions } = options;
  const trials = await new BenchmarkCampaignRunner(
    options.outputDir,
  ).runTrials<WorkflowBenchmarkArtifacts>({
    trialCount,
    minimum: 2,
    maximum: 10,
    invalidCountMessage: "Workflow benchmark --trials must be 2-10",
    runTrial: () => runWorkflowBenchmark(benchmarkOptions, dependencies),
    shouldStop: () => options.signal?.aborted === true,
  });
  const series = createWorkflowBenchmarkSeries({
    generatedAt: (dependencies?.now() ?? new Date()).toISOString(),
    requestedTrialCount: trialCount,
    trials: trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
    })),
  });
  const seriesPath = path.join(
    path.resolve(options.outputDir),
    `napier-workflow-benchmark-series-${series.caseId}-${series.contentSha256.slice(0, 16)}.json`,
  );
  await writeBenchmarkCasFile(
    seriesPath,
    `${JSON.stringify(series, null, 2)}\n`,
  );
  const verification = verifyWorkflowBenchmarkSeries(
    series,
    trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: trial.bundle,
    })),
  );
  if (!verification.valid) {
    throw new Error(
      `Workflow benchmark series failed self-verification: ${verification.diagnostics.join(",")}`,
    );
  }
  return { series, seriesPath, trials };
}

export function createWorkflowBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  includeUsageSampleCount?: boolean;
  includeSuccessRate?: boolean;
  trials: Array<{
    resultFileName: string;
    result: WorkflowBenchmarkResult;
  }>;
}): WorkflowBenchmarkSeries {
  if (
    !Number.isSafeInteger(input.requestedTrialCount) ||
    input.requestedTrialCount < 2 ||
    input.requestedTrialCount > 10 ||
    input.trials.length < 1 ||
    input.trials.length > input.requestedTrialCount
  ) {
    throw new Error("Workflow benchmark series trial count is invalid");
  }
  const first = input.trials[0]!.result;
  const resultHashes = new Set<string>();
  const threadIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.model) !== canonicalJson(first.model) ||
      canonicalJson(trial.result.environment) !==
        canonicalJson(first.environment) ||
      trial.resultFileName !==
        workflowBenchmarkResultFileName(
          trial.result.caseId,
          trial.result.contentSha256,
        ) ||
      resultHashes.has(trial.result.contentSha256) ||
      threadIds.has(trial.result.run.threadId)
    ) {
      throw new Error("Workflow benchmark series trials are inconsistent");
    }
    resultHashes.add(trial.result.contentSha256);
    threadIds.add(trial.result.run.threadId);
  }
  const results = input.trials.map((trial) => trial.result);
  const passedTrialCount = countStatus(results, "passed");
  const failedTrialCount = countStatus(results, "failed");
  const inconclusiveTrialCount = countStatus(results, "inconclusive");
  const scoredTrialCount = passedTrialCount + failedTrialCount;
  const completedTrialCount = results.length;
  const includeUsageSampleCount = input.includeUsageSampleCount ?? true;
  const includeSuccessRate = input.includeSuccessRate ?? true;
  const metricEvidence = createWorkflowBenchmarkSeriesMetrics(
    results,
    includeUsageSampleCount,
  );
  const content = {
    kind: "napier.workflow-benchmark-series" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: first.caseId,
    caseSha256: first.caseSha256,
    model: structuredClone(first.model),
    environment: structuredClone(first.environment),
    status:
      completedTrialCount === input.requestedTrialCount
        ? ("completed" as const)
        : ("cancelled" as const),
    requestedTrialCount: input.requestedTrialCount,
    completedTrialCount,
    scoredTrialCount,
    passedTrialCount,
    failedTrialCount,
    inconclusiveTrialCount,
    ...metricEvidence,
    ...(includeSuccessRate
      ? { successRate: passedTrialCount / completedTrialCount }
      : {}),
    completionRate: completedTrialCount / input.requestedTrialCount,
    passRate:
      scoredTrialCount === 0 ? null : passedTrialCount / scoredTrialCount,
    trials: input.trials.map(({ result, resultFileName }, index) => ({
      index: index + 1,
      threadId: result.run.threadId,
      status: result.status,
      resultFileName,
      resultSha256: result.contentSha256,
      ledgerFileName: result.ledger.bundleFileName,
      ledgerSha256: result.ledger.bundleSha256,
    })),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function workflowBenchmarkSeriesArtifactReferences(
  input: unknown,
): Array<{ index: number; resultFileName: string; ledgerFileName: string }> {
  if (!validSeriesShape(input)) {
    throw new Error("Workflow benchmark series artifact is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

export function verifyWorkflowBenchmarkSeries(
  input: unknown,
  artifacts: ReadonlyArray<{
    resultFileName: string;
    result: unknown;
    bundle: unknown;
  }>,
): WorkflowBenchmarkSeriesVerification {
  const diagnostics: string[] = [];
  const trialDiagnostics: WorkflowBenchmarkSeriesVerification["trialDiagnostics"] =
    [];
  if (!validSeriesShape(input)) {
    return {
      valid: false,
      diagnostics: ["series_shape_invalid"],
      seriesSha256: sha256(String(input)),
      trialDiagnostics,
    };
  }
  const series = input;
  const { contentSha256, ...content } = series;
  if (sha256(canonicalJson(content)) !== contentSha256) {
    diagnostics.push("series_hash_mismatch");
  }
  if (artifacts.length !== series.trials.length) {
    diagnostics.push("series_artifact_count_mismatch");
  }
  for (const trial of series.trials) {
    const artifact = artifacts[trial.index - 1];
    const verification = artifact
      ? verifyWorkflowBenchmarkArtifacts(artifact.result, artifact.bundle)
      : { valid: false, diagnostics: ["artifact_missing"] };
    const result = artifact?.result as WorkflowBenchmarkResult | undefined;
    const issues = [...verification.diagnostics];
    if (
      !artifact ||
      !verification.valid ||
      !result ||
      artifact.resultFileName !== trial.resultFileName ||
      result.contentSha256 !== trial.resultSha256 ||
      result.run.threadId !== trial.threadId ||
      result.status !== trial.status ||
      result.ledger.bundleFileName !== trial.ledgerFileName ||
      result.ledger.bundleSha256 !== trial.ledgerSha256
    ) {
      issues.push("trial_binding_mismatch");
    }
    if (issues.length > 0) {
      trialDiagnostics.push({ index: trial.index, diagnostics: issues });
    }
  }
  if (
    trialDiagnostics.length === 0 &&
    artifacts.length === series.trials.length
  ) {
    const recreated = createWorkflowBenchmarkSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      includeUsageSampleCount: series.usageSampleCount !== undefined,
      includeSuccessRate: series.successRate !== undefined,
      trials: artifacts.map((artifact) => ({
        resultFileName: artifact.resultFileName,
        result: artifact.result as WorkflowBenchmarkResult,
      })),
    });
    if (canonicalJson(recreated) !== canonicalJson(series)) {
      diagnostics.push("series_aggregate_mismatch");
    }
  }
  if (trialDiagnostics.length > 0) diagnostics.push("series_trial_invalid");
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    seriesSha256: series.contentSha256,
    trialDiagnostics,
  };
}

function validSeriesShape(value: unknown): value is WorkflowBenchmarkSeries {
  const hasUsageSampleCount = recordHasOwn(value, "usageSampleCount");
  const hasSuccessRate = recordHasOwn(value, "successRate");
  if (
    !exactRecord(value, [
      ...SERIES_KEYS,
      ...(hasUsageSampleCount ? ["usageSampleCount"] : []),
      ...(hasSuccessRate ? ["successRate"] : []),
    ])
  ) {
    return false;
  }
  const trials = value["trials"];
  return (
    value["kind"] === "napier.workflow-benchmark-series" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    (value["status"] === "completed" || value["status"] === "cancelled") &&
    validSeriesCounts(value) &&
    rate(value["completionRate"]) &&
    (value["successRate"] === undefined || rate(value["successRate"])) &&
    (value["passRate"] === null || rate(value["passRate"])) &&
    validWorkflowBenchmarkSeriesMetrics(value["metrics"]) &&
    Array.isArray(trials) &&
    trials.length === value["completedTrialCount"] &&
    trials.every((trial, index) =>
      validTrial(trial, index, String(value["caseId"])),
    ) &&
    digest(value["contentSha256"])
  );
}

function recordHasOwn(value: unknown, key: string): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, key)
  );
}

function validTrial(value: unknown, index: number, caseId: string): boolean {
  return (
    exactRecord(value, TRIAL_KEYS) &&
    value["index"] === index + 1 &&
    resourceId(value["threadId"]) &&
    resultStatus(value["status"]) &&
    safeFileName(value["resultFileName"]) &&
    digest(value["resultSha256"]) &&
    safeFileName(value["ledgerFileName"]) &&
    digest(value["ledgerSha256"]) &&
    value["resultFileName"] ===
      workflowBenchmarkResultFileName(caseId, String(value["resultSha256"])) &&
    value["ledgerFileName"] ===
      workflowBenchmarkLedgerFileName(caseId, String(value["ledgerSha256"]))
  );
}

function validSeriesCounts(series: Record<string, unknown>): boolean {
  if (
    !integerBetween(series["requestedTrialCount"], 2, 10) ||
    !integerBetween(series["completedTrialCount"], 1, 10) ||
    !integerBetween(series["scoredTrialCount"], 0, 10) ||
    !integerBetween(series["passedTrialCount"], 0, 10) ||
    !integerBetween(series["failedTrialCount"], 0, 10) ||
    !integerBetween(series["inconclusiveTrialCount"], 0, 10)
  ) {
    return false;
  }
  return (
    Number(series["scoredTrialCount"]) ===
      Number(series["passedTrialCount"]) + Number(series["failedTrialCount"]) &&
    Number(series["completedTrialCount"]) ===
      Number(series["scoredTrialCount"]) +
        Number(series["inconclusiveTrialCount"]) &&
    Number(series["completedTrialCount"]) <=
      Number(series["requestedTrialCount"]) &&
    validSeriesCompleteness(series) &&
    ((series["status"] === "completed" &&
      series["completedTrialCount"] === series["requestedTrialCount"]) ||
      (series["status"] === "cancelled" &&
        Number(series["completedTrialCount"]) <
          Number(series["requestedTrialCount"])))
  );
}

function validSeriesCompleteness(series: Record<string, unknown>): boolean {
  const usageSamples = series["usageSampleCount"];
  const successRate = series["successRate"];
  return (
    (usageSamples === undefined ||
      integerBetween(usageSamples, 0, Number(series["completedTrialCount"]))) &&
    (successRate === undefined ||
      (rate(successRate) &&
        Number(successRate) ===
          Number(series["passedTrialCount"]) /
            Number(series["completedTrialCount"])))
  );
}

function countStatus(
  results: WorkflowBenchmarkResult[],
  status: WorkflowBenchmarkResult["status"],
): number {
  return results.filter((result) => result.status === status).length;
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, ["provider", "id"]) &&
    typeof value["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value["id"])
  );
}

function validEnvironment(value: unknown): boolean {
  return (
    exactRecord(value, ["nodeVersion", "platform", "arch", "cliVersion"]) &&
    Object.values(value).every(
      (item) =>
        typeof item === "string" && item.length >= 1 && item.length <= 64,
    )
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function integerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function rate(value: unknown): value is number {
  return nonNegativeNumber(value) && value <= 1;
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function safeFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]{1,255}$/u.test(value)
  );
}

function resultStatus(value: unknown): boolean {
  return value === "passed" || value === "failed" || value === "inconclusive";
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
