import { validWorkflowBenchmarkRestartFields } from "./workflow-benchmark-restart-evidence.js";
import { validWorkflowBenchmarkSecurityFields } from "./workflow-benchmark-security-evidence.js";
import { validWorkflowBenchmarkSqliteFields } from "./workflow-benchmark-sqlite-evidence.js";

export function validWorkflowBenchmarkLedgerWorkflow(value: unknown): boolean {
  const workflow = recordValue(value);
  const mapRunIds = workflow["mapRunIds"];
  return (
    exactRecord(value, workflowKeys(workflow)) &&
    validWorkflowIdentity(workflow) &&
    Array.isArray(mapRunIds) &&
    mapRunIds.every(resourceId) &&
    new Set(mapRunIds).size === mapRunIds.length &&
    mapRunIds.every((id, index) => index === 0 || mapRunIds[index - 1]! < id) &&
    resourceId(workflow["reduceRunId"]) &&
    validWorkflowBenchmarkSqliteFields(workflow) &&
    validWorkflowBenchmarkSecurityFields(workflow) &&
    validWorkflowBenchmarkRestartFields(workflow) &&
    nonNegativeInteger(workflow["nodeResultCount"]) &&
    nonNegativeInteger(workflow["completedNodeResultCount"])
  );
}

function workflowKeys(workflow: Record<string, unknown>): readonly string[] {
  return [
    "manifestSha256",
    "blueprintSha256",
    "resultSha256",
    "outputSha256",
    "nodeResultCount",
    "completedNodeResultCount",
    "planId",
    "status",
    ...(workflow["mapOutputSha256"] === undefined ? [] : ["mapOutputSha256"]),
    "mapRunIds",
    "reduceRunId",
    ...(workflow["sqliteActionEvents"] === undefined
      ? []
      : ["sqliteActionEvents"]),
    ...(workflow["databaseBeforeSha256"] === undefined
      ? []
      : ["databaseBeforeSha256"]),
    ...(workflow["databaseAfterSha256"] === undefined
      ? []
      : ["databaseAfterSha256"]),
    ...(workflow["requiredSqliteEvidence"] === undefined
      ? []
      : ["requiredSqliteEvidence"]),
    ...(workflow["promptInjectionScan"] === undefined
      ? []
      : ["promptInjectionScan"]),
    ...(workflow["restartEvent"] === undefined ? [] : ["restartEvent"]),
    ...(workflow["preRestartMapRunIds"] === undefined
      ? []
      : ["preRestartMapRunIds"]),
  ];
}

function validWorkflowIdentity(workflow: Record<string, unknown>): boolean {
  return (
    resourceId(workflow["planId"]) &&
    workflow["status"] === "completed" &&
    digest(workflow["manifestSha256"]) &&
    digest(workflow["blueprintSha256"]) &&
    digest(workflow["resultSha256"]) &&
    digest(workflow["outputSha256"]) &&
    (workflow["mapOutputSha256"] === undefined ||
      digest(workflow["mapOutputSha256"]))
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

function recordValue(value: unknown): Record<string, unknown> {
  return record(value) ? value : {};
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
