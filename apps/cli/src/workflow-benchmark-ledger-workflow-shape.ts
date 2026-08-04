import {
  validWorkflowBenchmarkDataFrameFields,
  workflowBenchmarkDataFrameFieldDiagnostics,
} from "./workflow-benchmark-data-frame-evidence.js";
import { validWorkflowBenchmarkRestartFields } from "./workflow-benchmark-restart-evidence.js";
import { validWorkflowBenchmarkSecurityFields } from "./workflow-benchmark-security-evidence.js";
import { validWorkflowBenchmarkSqliteFields } from "./workflow-benchmark-sqlite-evidence.js";
import { isWorkflowBenchmarkStatus } from "./workflow-benchmark-terminal-event.js";

export function validWorkflowBenchmarkLedgerWorkflow(value: unknown): boolean {
  return workflowBenchmarkLedgerWorkflowDiagnostics(value).length === 0;
}

export function workflowBenchmarkLedgerWorkflowDiagnostics(
  value: unknown,
): string[] {
  const workflow = recordValue(value);
  const mapRunIds = workflow["mapRunIds"];
  const diagnostics: string[] = [];
  if (!exactRecord(value, workflowKeys(workflow))) {
    diagnostics.push("workflow_fields_invalid");
  }
  if (!validWorkflowIdentity(workflow)) {
    diagnostics.push("workflow_identity_invalid");
  }
  if (
    !Array.isArray(mapRunIds) ||
    !mapRunIds.every(resourceId) ||
    new Set(mapRunIds).size !== mapRunIds.length ||
    !mapRunIds.every((id, index) => index === 0 || mapRunIds[index - 1]! < id)
  ) {
    diagnostics.push("workflow_map_runs_invalid");
  }
  if (
    (workflow["status"] === "completed" &&
      !resourceId(workflow["reduceRunId"])) ||
    (workflow["status"] !== "completed" &&
      workflow["reduceRunId"] !== undefined &&
      !resourceId(workflow["reduceRunId"]))
  ) {
    diagnostics.push("workflow_reduce_run_invalid");
  }
  if (!validWorkflowBenchmarkSqliteFields(workflow)) {
    diagnostics.push("workflow_sqlite_fields_invalid");
  }
  if (!validWorkflowBenchmarkDataFrameFields(workflow)) {
    diagnostics.push(
      "workflow_data_frame_fields_invalid",
      ...workflowBenchmarkDataFrameFieldDiagnostics(workflow).map(
        (diagnostic) => `workflow_${diagnostic}`,
      ),
    );
  }
  if (!validWorkflowBenchmarkSecurityFields(workflow)) {
    diagnostics.push("workflow_security_fields_invalid");
  }
  if (!validWorkflowBenchmarkRestartFields(workflow)) {
    diagnostics.push("workflow_restart_fields_invalid");
  }
  if (
    !nonNegativeInteger(workflow["nodeResultCount"]) ||
    !nonNegativeInteger(workflow["completedNodeResultCount"])
  ) {
    diagnostics.push("workflow_counts_invalid");
  }
  return diagnostics;
}

function workflowKeys(workflow: Record<string, unknown>): readonly string[] {
  return [
    "manifestSha256",
    "blueprintSha256",
    "resultSha256",
    ...(workflow["outputSha256"] === undefined ? [] : ["outputSha256"]),
    "nodeResultCount",
    "completedNodeResultCount",
    "planId",
    "status",
    ...(workflow["mapOutputSha256"] === undefined ? [] : ["mapOutputSha256"]),
    "mapRunIds",
    ...(workflow["reduceRunId"] === undefined ? [] : ["reduceRunId"]),
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
    ...(workflow["dataFrameActionEvents"] === undefined
      ? []
      : ["dataFrameActionEvents"]),
    ...(workflow["dataSourceBeforeSha256"] === undefined
      ? []
      : ["dataSourceBeforeSha256"]),
    ...(workflow["dataSourceAfterSha256"] === undefined
      ? []
      : ["dataSourceAfterSha256"]),
    ...(workflow["requiredDataFrameEvidence"] === undefined
      ? []
      : ["requiredDataFrameEvidence"]),
    ...(workflow["promptInjectionScan"] === undefined
      ? []
      : ["promptInjectionScan"]),
    ...(workflow["restartEvent"] === undefined ? [] : ["restartEvent"]),
    ...(workflow["restartEvents"] === undefined ? [] : ["restartEvents"]),
    ...(workflow["preRestartMapRunIds"] === undefined
      ? []
      : ["preRestartMapRunIds"]),
  ];
}

function validWorkflowIdentity(workflow: Record<string, unknown>): boolean {
  return (
    resourceId(workflow["planId"]) &&
    isWorkflowBenchmarkStatus(workflow["status"]) &&
    digest(workflow["manifestSha256"]) &&
    digest(workflow["blueprintSha256"]) &&
    digest(workflow["resultSha256"]) &&
    (workflow["status"] === "completed"
      ? digest(workflow["outputSha256"])
      : workflow["outputSha256"] === undefined) &&
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
