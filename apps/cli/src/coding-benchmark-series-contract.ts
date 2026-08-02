import { canonicalJson, sha256 } from "@napier/runtime";

import { verifyCodingBenchmarkArtifacts } from "./coding-benchmark-contract.js";
import {
  createCodingBenchmarkSeriesMetrics,
  validCodingBenchmarkSeriesMetrics,
} from "./coding-benchmark-series-metrics.js";
import type {
  CodingBenchmarkSeries,
  CodingBenchmarkSeriesTrialArtifact,
  CodingBenchmarkSeriesVerification,
} from "./coding-benchmark-series-types.js";
import type { CodingBenchmarkResult } from "./coding-benchmark-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]{1,255}$/u;
const TOP_LEVEL_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 model environment status requestedTrialCount completedTrialCount scoredTrialCount passedTrialCount failedTrialCount inconclusiveTrialCount completionRate passRate applyPatchCompletedTrialCount metrics trials contentSha256",
);
const TRIAL_KEYS = keySet(
  "index runId status resultFileName resultSha256 ledgerFileName ledgerSha256",
);
const ENVIRONMENT_KEYS = keySet("nodeVersion platform arch cliVersion");
const MODEL_KEYS = keySet("provider id");

export function createCodingBenchmarkSeries(input: {
  generatedAt: string;
  requestedTrialCount: number;
  trials: Array<{
    resultFileName: string;
    result: CodingBenchmarkResult;
  }>;
}): CodingBenchmarkSeries {
  if (
    !Number.isSafeInteger(input.requestedTrialCount) ||
    input.requestedTrialCount < 2 ||
    input.requestedTrialCount > 10 ||
    input.trials.length < 1 ||
    input.trials.length > input.requestedTrialCount
  ) {
    throw new Error("Coding benchmark series trial count is invalid");
  }
  const first = input.trials[0]!.result;
  const resultSha256s = new Set<string>();
  const runIds = new Set<string>();
  for (const trial of input.trials) {
    if (
      trial.result.schemaVersion !== first.schemaVersion ||
      trial.result.caseId !== first.caseId ||
      trial.result.caseSha256 !== first.caseSha256 ||
      canonicalJson(trial.result.model) !== canonicalJson(first.model) ||
      canonicalJson(trial.result.environment) !==
        canonicalJson(first.environment) ||
      !safeFileName(trial.resultFileName) ||
      trial.resultFileName !== resultFileName(trial.result) ||
      resultSha256s.has(trial.result.contentSha256) ||
      runIds.has(trial.result.run.runId)
    ) {
      throw new Error("Coding benchmark series trials are inconsistent");
    }
    resultSha256s.add(trial.result.contentSha256);
    runIds.add(trial.result.run.runId);
  }
  const results = input.trials.map((trial) => trial.result);
  const passedTrialCount = results.filter(
    (result) => result.status === "passed",
  ).length;
  const failedTrialCount = results.filter(
    (result) => result.status === "failed",
  ).length;
  const inconclusiveTrialCount = results.filter(
    (result) => result.status === "inconclusive",
  ).length;
  const scoredTrialCount = passedTrialCount + failedTrialCount;
  const completedTrialCount = results.length;
  const content = {
    kind: "napier.coding-benchmark-series" as const,
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
    completionRate: completedTrialCount / input.requestedTrialCount,
    passRate:
      scoredTrialCount === 0 ? null : passedTrialCount / scoredTrialCount,
    applyPatchCompletedTrialCount: results.filter(
      (result) => result.tooling.applyPatchCompleted,
    ).length,
    metrics: createCodingBenchmarkSeriesMetrics(results),
    trials: input.trials.map(({ result, resultFileName }, index) => ({
      index: index + 1,
      runId: result.run.runId,
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

export function codingBenchmarkSeriesArtifactReferences(
  input: unknown,
): Array<{ index: number; resultFileName: string; ledgerFileName: string }> {
  if (!validSeriesShape(input)) {
    throw new Error("Coding benchmark series artifact is invalid");
  }
  return input.trials.map((trial) => ({
    index: trial.index,
    resultFileName: trial.resultFileName,
    ledgerFileName: trial.ledgerFileName,
  }));
}

export function verifyCodingBenchmarkSeries(
  input: unknown,
  artifacts: readonly CodingBenchmarkSeriesTrialArtifact[],
): CodingBenchmarkSeriesVerification {
  const diagnostics: string[] = [];
  const trialDiagnostics: CodingBenchmarkSeriesVerification["trialDiagnostics"] =
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
      ? verifyCodingBenchmarkArtifacts(artifact.result, artifact.bundle)
      : { valid: false, diagnostics: ["artifact_missing"] };
    const issues = [...verification.diagnostics];
    const result = artifact?.result as CodingBenchmarkResult | undefined;
    if (
      !artifact ||
      !verification.valid ||
      !result ||
      artifact.resultFileName !== trial.resultFileName ||
      result.contentSha256 !== trial.resultSha256 ||
      result.run.runId !== trial.runId ||
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
    const recreated = createCodingBenchmarkSeries({
      generatedAt: series.generatedAt,
      requestedTrialCount: series.requestedTrialCount,
      trials: artifacts.map((artifact) => ({
        resultFileName: artifact.resultFileName,
        result: artifact.result as CodingBenchmarkResult,
      })),
    });
    if (canonicalJson(recreated) !== canonicalJson(series)) {
      diagnostics.push("series_aggregate_mismatch");
    }
  }
  if (trialDiagnostics.length > 0) {
    diagnostics.push("series_trial_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    seriesSha256: contentSha256,
    trialDiagnostics,
  };
}

function validSeriesShape(value: unknown): value is CodingBenchmarkSeries {
  if (!exactRecord(value, TOP_LEVEL_KEYS)) return false;
  return (
    value["kind"] === "napier.coding-benchmark-series" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    (value["status"] === "completed" || value["status"] === "cancelled") &&
    integerBetween(value["requestedTrialCount"], 2, 10) &&
    integerBetween(value["completedTrialCount"], 1, 10) &&
    integerBetween(value["scoredTrialCount"], 0, 10) &&
    integerBetween(value["passedTrialCount"], 0, 10) &&
    integerBetween(value["failedTrialCount"], 0, 10) &&
    integerBetween(value["inconclusiveTrialCount"], 0, 10) &&
    rate(value["completionRate"]) &&
    (value["passRate"] === null || rate(value["passRate"])) &&
    integerBetween(value["applyPatchCompletedTrialCount"], 0, 10) &&
    validCodingBenchmarkSeriesMetrics(value["metrics"]) &&
    Array.isArray(value["trials"]) &&
    value["trials"].length === value["completedTrialCount"] &&
    value["trials"].every((trial, index) =>
      validTrial(trial, index, String(value["caseId"])),
    ) &&
    isSha256(value["contentSha256"])
  );
}

function validTrial(value: unknown, index: number, caseId: string): boolean {
  return (
    exactRecord(value, TRIAL_KEYS) &&
    value["index"] === index + 1 &&
    resourceId(value["runId"]) &&
    (value["status"] === "passed" ||
      value["status"] === "failed" ||
      value["status"] === "inconclusive") &&
    safeFileName(value["resultFileName"]) &&
    isSha256(value["resultSha256"]) &&
    value["resultFileName"] ===
      `napier-benchmark-result-${caseId}-${value["resultSha256"].slice(0, 16)}.json` &&
    safeFileName(value["ledgerFileName"]) &&
    isSha256(value["ledgerSha256"]) &&
    value["ledgerFileName"] ===
      `napier-benchmark-ledger-${caseId}-${value["ledgerSha256"].slice(0, 16)}.json`
  );
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, MODEL_KEYS) &&
    typeof value["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u.test(value["id"])
  );
}

function validEnvironment(value: unknown): boolean {
  return (
    exactRecord(value, ENVIRONMENT_KEYS) &&
    ENVIRONMENT_KEYS.every(
      (key) =>
        typeof value[key] === "string" &&
        value[key].trim().length >= 1 &&
        value[key].length <= 64,
    )
  );
}

function resultFileName(result: CodingBenchmarkResult): string {
  return `napier-benchmark-result-${result.caseId}-${result.contentSha256.slice(0, 16)}.json`;
}

function safeFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "." &&
    value !== ".." &&
    SAFE_FILE_NAME.test(value)
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function rate(value: unknown): value is number {
  return nonNegativeNumber(value) && value <= 1;
}

function integerBetween(
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

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
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

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
