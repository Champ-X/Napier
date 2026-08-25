import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type { OpenWebResearchFreshnessCampaign } from "./open-web-research-freshness-campaign-types.js";

export const OPEN_WEB_RESEARCH_OBSERVATION_GAP_MS = 24 * 60 * 60 * 1_000;

export function validOpenWebResearchFreshnessCampaignShape(
  value: unknown,
): value is OpenWebResearchFreshnessCampaign {
  if (!exactRecord(value, campaignKeys())) return false;
  const { contentSha256, ...content } = value;
  return (
    validIdentity(value) &&
    validCounts(value) &&
    validObservationWindow(value) &&
    validMetrics(value["metrics"]) &&
    Array.isArray(value["observations"]) &&
    value["observations"].length === value["observationCount"] &&
    value["observations"].every(validObservation) &&
    value["observations"].every(
      (observation, index) =>
        record(observation) && observation["index"] === index + 1,
    ) &&
    uniqueObservationArtifacts(value["observations"]) &&
    digest(value["sourceEvidenceSetSha256"]) &&
    digest(value["citationEvidenceSetSha256"]) &&
    digest(value["observationSetSha256"]) &&
    digest(value["resultSetSha256"]) &&
    digest(contentSha256) &&
    sha256(canonicalJson(content as unknown as JsonValue)) === contentSha256
  );
}

function validIdentity(value: Record<string, unknown>): boolean {
  return (
    value["kind"] === "napier.open-web-research-freshness-campaign" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    value["requiredObservationGapMs"] === OPEN_WEB_RESEARCH_OBSERVATION_GAP_MS
  );
}

function validCounts(value: Record<string, unknown>): boolean {
  const trials = value["trialCount"];
  return (
    integerBetween(value["observationCount"], 2, 10) &&
    integerBetween(trials, 2, 100) &&
    [
      "passedTrialCount",
      "failedTrialCount",
      "inconclusiveTrialCount",
      "claimsMatchTrialCount",
      "toolTopologyMatchTrialCount",
      "sourceCoverageMatchTrialCount",
      "citationEvidenceMatchTrialCount",
      "citationClaimsMatchTrialCount",
      "replayValidTrialCount",
      "credentialLeakTrialCount",
    ].every((key) => aggregateCount(value[key], trials)) &&
    validRate(value["passRate"]) &&
    integerBetween(value["uniqueSourceEvidenceCount"], 1, 100) &&
    integerBetween(value["uniqueCitationEvidenceCount"], 1, 100)
  );
}

function validObservationWindow(value: Record<string, unknown>): boolean {
  return (
    validIsoDate(value["firstObservedAt"]) &&
    validIsoDate(value["lastObservedAt"]) &&
    Date.parse(String(value["firstObservedAt"])) <=
      Date.parse(String(value["lastObservedAt"])) &&
    Date.parse(String(value["lastObservedAt"])) <=
      Date.parse(String(value["generatedAt"])) &&
    nonnegativeInteger(value["observationSpanMs"]) &&
    nonnegativeInteger(value["minimumObservationGapMs"])
  );
}

function validObservation(value: unknown): boolean {
  if (
    !exactRecord(value, [
      "index",
      "artifactKind",
      "artifactFileName",
      "artifactContentSha256",
      "firstObservedAt",
      "lastObservedAt",
      "trialCount",
      "passedTrialCount",
      "failedTrialCount",
      "inconclusiveTrialCount",
      "claimsMatchTrialCount",
      "toolTopologyMatchTrialCount",
      "sourceCoverageMatchTrialCount",
      "citationEvidenceMatchTrialCount",
      "citationClaimsMatchTrialCount",
      "replayValidTrialCount",
      "credentialLeakTrialCount",
      "resultSetSha256",
    ])
  ) {
    return false;
  }
  const trials = value["trialCount"];
  return (
    positiveInteger(value["index"]) &&
    (value["artifactKind"] === "result" ||
      value["artifactKind"] === "series") &&
    safeArtifactName(value["artifactFileName"], value["artifactKind"]) &&
    digest(value["artifactContentSha256"]) &&
    validIsoDate(value["firstObservedAt"]) &&
    validIsoDate(value["lastObservedAt"]) &&
    integerBetween(trials, 1, 10) &&
    [
      "passedTrialCount",
      "failedTrialCount",
      "inconclusiveTrialCount",
      "claimsMatchTrialCount",
      "toolTopologyMatchTrialCount",
      "sourceCoverageMatchTrialCount",
      "citationEvidenceMatchTrialCount",
      "citationClaimsMatchTrialCount",
      "replayValidTrialCount",
      "credentialLeakTrialCount",
    ].every((key) => aggregateCount(value[key], trials)) &&
    digest(value["resultSetSha256"])
  );
}

function validMetrics(value: unknown): boolean {
  return (
    exactRecord(value, [
      "durationMs",
      "costUsd",
      "inputTokens",
      "outputTokens",
      "searchCount",
      "fetchCount",
      "browserCount",
      "researchCaptureCount",
      "citationCount",
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

function uniqueObservationArtifacts(observations: unknown[]): boolean {
  return ["artifactFileName", "artifactContentSha256"].every(
    (key) =>
      new Set(
        observations.map((observation) =>
          record(observation) ? observation[key] : undefined,
        ),
      ).size === observations.length,
  );
}

function safeArtifactName(value: unknown, kind: unknown): value is string {
  if (typeof value !== "string") return false;
  return kind === "result"
    ? /^napier-open-web-research-benchmark-result-[a-z][a-z0-9_]{2,80}-[a-f0-9]{16}\.json$/u.test(
        value,
      )
    : /^napier-open-web-research-series-[a-z][a-z0-9_]{2,80}-[a-f0-9]{16}\.json$/u.test(
        value,
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

function aggregateCount(value: unknown, total: unknown): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number.isSafeInteger(total) &&
    Number(value) <= Number(total)
  );
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function campaignKeys(): readonly string[] {
  return [
    "kind",
    "schemaVersion",
    "generatedAt",
    "caseId",
    "caseSha256",
    "model",
    "environment",
    "requiredObservationGapMs",
    "observationCount",
    "firstObservedAt",
    "lastObservedAt",
    "observationSpanMs",
    "minimumObservationGapMs",
    "trialCount",
    "passedTrialCount",
    "failedTrialCount",
    "inconclusiveTrialCount",
    "claimsMatchTrialCount",
    "toolTopologyMatchTrialCount",
    "sourceCoverageMatchTrialCount",
    "citationEvidenceMatchTrialCount",
    "citationClaimsMatchTrialCount",
    "replayValidTrialCount",
    "credentialLeakTrialCount",
    "passRate",
    "uniqueSourceEvidenceCount",
    "uniqueCitationEvidenceCount",
    "sourceEvidenceSetSha256",
    "citationEvidenceSetSha256",
    "metrics",
    "observations",
    "observationSetSha256",
    "resultSetSha256",
    "contentSha256",
  ];
}
