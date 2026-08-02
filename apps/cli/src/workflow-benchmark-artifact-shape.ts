import type { JsonValue } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  WorkflowBenchmarkEvaluation,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";

const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status workflowStatus criteriaSha256 expectedOutputSha256 actualOutputSha256 expectedMapOutputSha256 actualMapOutputSha256 outputMatch mapOutputMatch expectedNodeResultCount completedNodeResultCount expectedMapItemCount completedMapRunCount mapCompletedEventCount reduceCompletedEventCount reduceModelOrToolEventCount replayValid credentialLeakDetected sqliteSchemaCompletedCount sqliteQueryCompletedCount sqliteChartCompletedCount sqliteProtocolValid sqliteEvidenceMatch promptInjectionLeakDetected databaseUnchanged runtimeRestartCount approvalRecovered completedMapRunsReused postRestartModelResponseCount diagnostics contentSha256",
);
const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run workflow evaluation ledger contentSha256",
);

export function validWorkflowBenchmarkResultShape(
  value: unknown,
): value is WorkflowBenchmarkResult {
  if (!exactRecord(value, RESULT_KEYS)) return false;
  return (
    value["kind"] === "napier.workflow-benchmark-result" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resultStatus(value["status"]) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validRun(value["run"]) &&
    validWorkflow(value["workflow"]) &&
    validWorkflowBenchmarkEvaluationShape(value["evaluation"]) &&
    validLedger(value["ledger"]) &&
    digest(value["contentSha256"])
  );
}

export function validWorkflowBenchmarkEvaluationShape(
  value: unknown,
): value is WorkflowBenchmarkEvaluation {
  const evaluation = record(value);
  const keys = evaluationKeys(evaluation);
  if (!exactRecord(value, keys)) return false;
  const { contentSha256, ...content } = value;
  return (
    validEvaluationIdentity(value) &&
    validEvaluationOutcome(value) &&
    validEvaluationCounts(value) &&
    validEvaluationEvidence(value) &&
    validDiagnostics(value["diagnostics"]) &&
    digest(contentSha256) &&
    sha256(canonicalJson(content as unknown as JsonValue)) === contentSha256
  );
}

function evaluationKeys(
  evaluation: Record<string, unknown>,
): readonly string[] {
  const optional = new Set([
    "actualOutputSha256",
    "actualMapOutputSha256",
    "sqliteSchemaCompletedCount",
    "sqliteQueryCompletedCount",
    "sqliteChartCompletedCount",
    "sqliteProtocolValid",
    "sqliteEvidenceMatch",
    "promptInjectionLeakDetected",
    "databaseUnchanged",
    "runtimeRestartCount",
    "approvalRecovered",
    "completedMapRunsReused",
    "postRestartModelResponseCount",
  ]);
  const keys = EVALUATION_KEYS.filter((key) => !optional.has(key));
  if (evaluation["actualOutputSha256"] !== undefined) {
    keys.push("actualOutputSha256");
  }
  if (evaluation["actualMapOutputSha256"] !== undefined) {
    keys.push("actualMapOutputSha256");
  }
  if (evaluation["schemaVersion"] === 2 || evaluation["schemaVersion"] === 3) {
    keys.push(
      "sqliteSchemaCompletedCount",
      "sqliteQueryCompletedCount",
      "sqliteChartCompletedCount",
      "sqliteProtocolValid",
      "databaseUnchanged",
    );
  }
  if (evaluation["schemaVersion"] === 3) {
    keys.push("sqliteEvidenceMatch", "promptInjectionLeakDetected");
  }
  if (evaluation["schemaVersion"] === 4) {
    keys.push(
      "runtimeRestartCount",
      "approvalRecovered",
      "completedMapRunsReused",
      "postRestartModelResponseCount",
    );
  }
  return keys;
}

function validEvaluationIdentity(evaluation: Record<string, unknown>): boolean {
  return (
    evaluation["kind"] === "napier.workflow-benchmark-evaluation" &&
    (evaluation["schemaVersion"] === 1 ||
      evaluation["schemaVersion"] === 2 ||
      evaluation["schemaVersion"] === 3 ||
      evaluation["schemaVersion"] === 4) &&
    resourceId(evaluation["caseId"]) &&
    digest(evaluation["caseSha256"]) &&
    resultStatus(evaluation["status"]) &&
    workflowStatus(evaluation["workflowStatus"]) &&
    digest(evaluation["criteriaSha256"])
  );
}

function validEvaluationOutcome(evaluation: Record<string, unknown>): boolean {
  return (
    digest(evaluation["expectedOutputSha256"]) &&
    optionalDigest(evaluation["actualOutputSha256"]) &&
    digest(evaluation["expectedMapOutputSha256"]) &&
    optionalDigest(evaluation["actualMapOutputSha256"]) &&
    typeof evaluation["outputMatch"] === "boolean" &&
    typeof evaluation["mapOutputMatch"] === "boolean"
  );
}

function validEvaluationEvidence(evaluation: Record<string, unknown>): boolean {
  if (
    typeof evaluation["replayValid"] !== "boolean" ||
    typeof evaluation["credentialLeakDetected"] !== "boolean"
  ) {
    return false;
  }
  if (evaluation["schemaVersion"] === 4) {
    return (
      nonNegativeInteger(evaluation["runtimeRestartCount"]) &&
      typeof evaluation["approvalRecovered"] === "boolean" &&
      typeof evaluation["completedMapRunsReused"] === "boolean" &&
      nonNegativeInteger(evaluation["postRestartModelResponseCount"])
    );
  }
  return (
    evaluation["schemaVersion"] === 1 ||
    (nonNegativeInteger(evaluation["sqliteSchemaCompletedCount"]) &&
      nonNegativeInteger(evaluation["sqliteQueryCompletedCount"]) &&
      nonNegativeInteger(evaluation["sqliteChartCompletedCount"]) &&
      typeof evaluation["sqliteProtocolValid"] === "boolean" &&
      typeof evaluation["databaseUnchanged"] === "boolean" &&
      (evaluation["schemaVersion"] === 2 ||
        (typeof evaluation["sqliteEvidenceMatch"] === "boolean" &&
          typeof evaluation["promptInjectionLeakDetected"] === "boolean")))
  );
}

function validModel(value: unknown): boolean {
  return (
    exactRecord(value, ["provider", "id"]) &&
    typeof value["provider"] === "string" &&
    /^[a-z][a-z0-9_-]{0,63}$/u.test(value["provider"]) &&
    boundedString(value["id"], 1, 160)
  );
}

function validEnvironment(value: unknown): boolean {
  return (
    exactRecord(value, ["nodeVersion", "platform", "arch", "cliVersion"]) &&
    Object.values(value).every((item) => boundedString(item, 1, 64))
  );
}

function validRun(value: unknown): boolean {
  return (
    exactRecord(value, [
      "threadId",
      "planId",
      "status",
      "durationMs",
      "runCount",
      "completedRunCount",
      "usage",
    ]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["planId"]) &&
    workflowStatus(value["status"]) &&
    nonNegativeNumber(value["durationMs"]) &&
    nonNegativeInteger(value["runCount"]) &&
    nonNegativeInteger(value["completedRunCount"]) &&
    Number(value["completedRunCount"]) <= Number(value["runCount"]) &&
    validUsage(value["usage"])
  );
}

function validWorkflow(value: unknown): boolean {
  const workflow = record(value);
  return (
    exactRecord(value, [
      "manifestSha256",
      "blueprintSha256",
      "resultSha256",
      ...(workflow["outputSha256"] === undefined ? [] : ["outputSha256"]),
      "nodeResultCount",
      "completedNodeResultCount",
    ]) &&
    digest(workflow["manifestSha256"]) &&
    digest(workflow["blueprintSha256"]) &&
    digest(workflow["resultSha256"]) &&
    optionalDigest(workflow["outputSha256"]) &&
    nonNegativeInteger(workflow["nodeResultCount"]) &&
    nonNegativeInteger(workflow["completedNodeResultCount"]) &&
    Number(workflow["completedNodeResultCount"]) <=
      Number(workflow["nodeResultCount"])
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
    nonNegativeInteger(value["eventSeq"]) &&
    digest(value["eventSha256"]) &&
    digest(value["eventStreamSha256"]) &&
    safeFileName(value["bundleFileName"]) &&
    digest(value["bundleSha256"]) &&
    nonNegativeInteger(value["bundleBytes"])
  );
}

function validEvaluationCounts(evaluation: Record<string, unknown>): boolean {
  return [
    "expectedNodeResultCount",
    "completedNodeResultCount",
    "expectedMapItemCount",
    "completedMapRunCount",
    "mapCompletedEventCount",
    "reduceCompletedEventCount",
    "reduceModelOrToolEventCount",
  ].every((key) => nonNegativeInteger(evaluation[key]));
}

function validDiagnostics(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (item) =>
        typeof item === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(item),
    )
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
    ]) && Object.values(value).every(nonNegativeNumber)
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function safeFileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "." &&
    value !== ".." &&
    /^[A-Za-z0-9._-]{1,255}$/u.test(value)
  );
}

function boundedString(
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

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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

function resultStatus(value: unknown): boolean {
  return value === "passed" || value === "failed" || value === "inconclusive";
}

function workflowStatus(value: unknown): boolean {
  return (
    value === "completed" ||
    value === "waiting" ||
    value === "paused" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
