import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type { UxBenchmarkSeries } from "./ux-benchmark-types.js";

export function validUxBenchmarkSeriesShape(
  value: unknown,
): value is UxBenchmarkSeries {
  if (!exactRecord(value, seriesKeys())) return false;
  const { contentSha256, ...content } = value;
  return (
    validIdentity(value) &&
    validAggregates(value) &&
    Array.isArray(value["trials"]) &&
    value["trials"].length === value["completedTrialCount"] &&
    value["trials"].every(validTrial) &&
    value["trials"].every(
      (trial, index) => record(trial) && trial["index"] === index + 1,
    ) &&
    uniqueTrialIdentities(value["trials"]) &&
    validMetrics(value["metrics"]) &&
    digest(contentSha256) &&
    sha256(canonicalJson(content as unknown as JsonValue)) === contentSha256
  );
}

function validIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.ux-benchmark-series" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    (value["status"] === "completed" || value["status"] === "cancelled")
  );
}

function validAggregates(value: Record<string, unknown>): boolean {
  return (
    integerBetween(value["requestedTrialCount"], 2, 10) &&
    nonNegativeInteger(value["completedTrialCount"]) &&
    nonNegativeInteger(value["passedTrialCount"]) &&
    nonNegativeInteger(value["failedTrialCount"]) &&
    nonNegativeInteger(value["inconclusiveTrialCount"]) &&
    validRate(value["completionRate"]) &&
    (value["passRate"] === null || validRate(value["passRate"]))
  );
}

function validTrial(value: unknown): boolean {
  return (
    exactRecord(value, [
      "index",
      "threadId",
      "status",
      "resultFileName",
      "resultSha256",
      "ledgerFileName",
      "ledgerSha256",
    ]) &&
    positiveInteger(value["index"]) &&
    resourceId(value["threadId"]) &&
    ["passed", "failed", "inconclusive"].includes(String(value["status"])) &&
    safeArtifactName(value["resultFileName"], "result") &&
    digest(value["resultSha256"]) &&
    safeArtifactName(value["ledgerFileName"], "ledger") &&
    digest(value["ledgerSha256"])
  );
}

function validMetrics(value: unknown): boolean {
  return (
    exactRecord(value, [
      "firstEventMs",
      "totalDurationMs",
      "costUsd",
      "inputTokens",
      "outputTokens",
    ]) && Object.values(value).every(validMetric)
  );
}

function validMetric(value: unknown): boolean {
  return (
    exactRecord(value, ["total", "min", "p50", "p95", "max", "mean"]) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
    )
  );
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

function uniqueTrialIdentities(trials: unknown[]): boolean {
  return ["threadId", "resultSha256", "ledgerSha256"].every(
    (key) =>
      new Set(trials.map((trial) => (record(trial) ? trial[key] : undefined)))
        .size === trials.length,
  );
}

function safeArtifactName(value: unknown, kind: "result" | "ledger"): boolean {
  return (
    typeof value === "string" &&
    new RegExp(
      `^napier-ux-benchmark-${kind}-[a-z][a-z0-9_]{2,80}-[a-f0-9]{16}\\.json$`,
      "u",
    ).test(value)
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function validRate(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
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

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function validIsoDate(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function seriesKeys(): readonly string[] {
  return [
    "kind",
    "schemaVersion",
    "generatedAt",
    "caseId",
    "caseSha256",
    "model",
    "environment",
    "status",
    "requestedTrialCount",
    "completedTrialCount",
    "passedTrialCount",
    "failedTrialCount",
    "inconclusiveTrialCount",
    "completionRate",
    "passRate",
    "metrics",
    "trials",
    "contentSha256",
  ];
}
