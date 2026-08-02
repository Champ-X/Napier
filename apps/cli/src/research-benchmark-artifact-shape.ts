import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  ResearchBenchmarkEvaluation,
  ResearchBenchmarkResult,
} from "./research-benchmark-types.js";

const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 expectedClaimsSha256 actualClaimsSha256 claimsMatch expectedCitationEvidenceSha256 actualCitationEvidenceSha256 citationEvidenceMatch expectedSourceSetSha256 actualSourceSetSha256 sourceCaptureMatch captureCount citationCount primarySourceCount secondarySourceCount contradictionFound reportVerified reportFileSha256 reportFileBytes replayValid credentialLeakDetected diagnostics contentSha256",
);
const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run report evaluation ledger contentSha256",
);

export function validResearchBenchmarkResultShape(
  value: unknown,
): value is ResearchBenchmarkResult {
  if (!exactRecord(value, RESULT_KEYS)) return false;
  return (
    value["kind"] === "napier.research-benchmark-result" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validRun(value["run"]) &&
    validReport(value["report"]) &&
    validEvaluation(value["evaluation"]) &&
    validLedger(value["ledger"]) &&
    digest(value["contentSha256"])
  );
}

function validEvaluation(value: unknown): value is ResearchBenchmarkEvaluation {
  if (!record(value)) return false;
  const keys = EVALUATION_KEYS.filter(
    (key) =>
      !(
        (key === "actualClaimsSha256" &&
          value["actualClaimsSha256"] === undefined) ||
        (key === "reportFileSha256" && value["reportFileSha256"] === undefined)
      ),
  );
  if (!exactRecord(value, keys)) return false;
  const { contentSha256, ...content } = value;
  return (
    validEvaluationIdentity(value) &&
    validEvaluationEvidence(value) &&
    digest(contentSha256) &&
    sha256(canonicalJson(content as unknown as JsonValue)) === contentSha256
  );
}

function validEvaluationIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.research-benchmark-evaluation" &&
    value["schemaVersion"] === 1 &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    runStatus(value["runStatus"]) &&
    digest(value["criteriaSha256"]) &&
    digest(value["expectedClaimsSha256"]) &&
    optionalDigest(value["actualClaimsSha256"]) &&
    digest(value["expectedCitationEvidenceSha256"]) &&
    digest(value["actualCitationEvidenceSha256"]) &&
    digest(value["expectedSourceSetSha256"]) &&
    digest(value["actualSourceSetSha256"])
  );
}

function validEvaluationEvidence(value: Record<string, unknown>): boolean {
  return (
    typeof value["claimsMatch"] === "boolean" &&
    typeof value["citationEvidenceMatch"] === "boolean" &&
    typeof value["sourceCaptureMatch"] === "boolean" &&
    [
      "captureCount",
      "citationCount",
      "primarySourceCount",
      "secondarySourceCount",
      "reportFileBytes",
    ].every((key) => nonNegativeInteger(value[key])) &&
    [
      "contradictionFound",
      "reportVerified",
      "replayValid",
      "credentialLeakDetected",
    ].every((key) => typeof value[key] === "boolean") &&
    optionalDigest(value["reportFileSha256"]) &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every((item) => typeof item === "string")
  );
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, ["provider", "id"]) &&
    typeof value["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(value["provider"]) &&
    typeof value["id"] === "string" &&
    value["id"].length >= 1 &&
    value["id"].length <= 160
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

function validRun(value: unknown): boolean {
  return (
    exactRecord(value, [
      "threadId",
      "runId",
      "status",
      "durationMs",
      "usage",
    ]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    runStatus(value["status"]) &&
    nonNegativeInteger(value["durationMs"]) &&
    validUsage(value["usage"])
  );
}

function validReport(value: unknown): boolean {
  if (!record(value)) return false;
  const keys =
    value["fileSha256"] === undefined
      ? ["pathSha256", "fileBytes"]
      : ["pathSha256", "fileSha256", "fileBytes"];
  return (
    exactRecord(value, keys) &&
    digest(value["pathSha256"]) &&
    optionalDigest(value["fileSha256"]) &&
    nonNegativeInteger(value["fileBytes"])
  );
}

function validLedger(value: unknown): boolean {
  return (
    exactRecord(value, [
      "eventId",
      "eventSeq",
      "eventSha256",
      "eventStreamSha256",
      "bundleFileName",
      "bundleSha256",
      "bundleBytes",
    ]) &&
    resourceId(value["eventId"]) &&
    positiveInteger(value["eventSeq"]) &&
    digest(value["eventSha256"]) &&
    digest(value["eventStreamSha256"]) &&
    typeof value["bundleFileName"] === "string" &&
    /^napier-research-benchmark-ledger-[a-z0-9_-]+-[a-f0-9]{16}\.json$/u.test(
      value["bundleFileName"],
    ) &&
    digest(value["bundleSha256"]) &&
    positiveInteger(value["bundleBytes"])
  );
}

function validUsage(value: unknown): boolean {
  return (
    exactRecord(value, [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
    ]) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item) && item >= 0,
    )
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

function resultStatus(value: unknown): boolean {
  return ["passed", "failed", "inconclusive"].includes(String(value));
}

function runStatus(
  value: unknown,
): value is ResearchBenchmarkResult["run"]["status"] {
  return [
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ].includes(String(value));
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalDigest(value: unknown): boolean {
  return value === undefined || digest(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
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
