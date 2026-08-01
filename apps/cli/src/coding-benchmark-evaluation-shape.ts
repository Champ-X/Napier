import type { RunStatus } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  CodingBenchmarkEvaluation,
  CodingBenchmarkOutcomeTestEvidence,
} from "./coding-benchmark-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const EMPTY_SET_SHA256 = sha256(canonicalJson([]));
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const V1_DIAGNOSTICS = new Set([
  "run_not_completed",
  "workspace_snapshot_truncated",
  "target_mismatch",
  "expected_change_missing",
  "unexpected_workspace_changes",
]);
const V2_DIAGNOSTICS = new Set([
  "run_not_completed",
  "workspace_snapshot_truncated",
  "outcome_test_failed",
  "outcome_test_unavailable",
  "expected_change_missing",
  "unexpected_workspace_changes",
]);
const V3_DIAGNOSTICS = new Set([...V2_DIAGNOSTICS, "required_tool_missing"]);
const V1_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedFileCount changedPathSetSha256 targetSemanticMatch allowedChangeSetMatch diagnostics contentSha256",
);
const V2_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedFileCount changedPathSetSha256 targetSemanticMatch allowedChangeSetMatch outcomeTest diagnostics contentSha256",
);
const V3_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedFileCount changedPathSetSha256 targetSemanticMatch allowedChangeSetMatch outcomeTest requiredToolCount completedRequiredToolCount requiredToolSetSha256 completedRequiredToolSetSha256 diagnostics contentSha256",
);
const OUTCOME_KEYS = keySet(
  "testSha256 status sandboxId resultSha256 durationMs exitCode stdoutSha256 stderrSha256 passed",
);
const SHA256_KEYS = keySet(
  "criteriaSha256 workspaceBeforeSha256 workspaceAfterSha256 targetBeforeSha256 targetAfterSha256 expectedTargetSha256 targetAfterAstSha256 expectedTargetAstSha256 changedPathSetSha256 contentSha256",
);

export function validCodingBenchmarkEvaluationShape(
  value: unknown,
): value is CodingBenchmarkEvaluation {
  if (!record(value)) return false;
  const schemaVersion = value["schemaVersion"];
  if (
    (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) ||
    !exactRecord(
      value,
      schemaVersion === 3 ? V3_KEYS : schemaVersion === 2 ? V2_KEYS : V1_KEYS,
    )
  ) {
    return false;
  }
  const diagnosticSet =
    schemaVersion === 1
      ? V1_DIAGNOSTICS
      : schemaVersion === 2
        ? V2_DIAGNOSTICS
        : V3_DIAGNOSTICS;
  const diagnostics = value["diagnostics"];
  const diagnosticsArray = Array.isArray(diagnostics) ? diagnostics : undefined;
  const outcome =
    schemaVersion >= 2 && validOutcome(value["outcomeTest"])
      ? value["outcomeTest"]
      : undefined;
  const requiredToolCount =
    schemaVersion === 3 && nonNegativeInteger(value["requiredToolCount"])
      ? Number(value["requiredToolCount"])
      : undefined;
  const completedRequiredToolCount =
    schemaVersion === 3 &&
    nonNegativeInteger(value["completedRequiredToolCount"])
      ? Number(value["completedRequiredToolCount"])
      : undefined;
  const requiredToolMissing =
    schemaVersion === 3 &&
    requiredToolCount !== undefined &&
    completedRequiredToolCount !== undefined &&
    completedRequiredToolCount < requiredToolCount;
  const requiredToolSetSha256 = value["requiredToolSetSha256"];
  const completedRequiredToolSetSha256 =
    value["completedRequiredToolSetSha256"];
  const toolSetCountsMatch =
    schemaVersion === 3 &&
    requiredToolCount !== undefined &&
    completedRequiredToolCount !== undefined &&
    isSha256(requiredToolSetSha256) &&
    isSha256(completedRequiredToolSetSha256) &&
    requiredToolSetSha256 !== EMPTY_SET_SHA256 &&
    (completedRequiredToolCount === 0
      ? completedRequiredToolSetSha256 === EMPTY_SET_SHA256
      : completedRequiredToolCount === requiredToolCount
        ? completedRequiredToolSetSha256 === requiredToolSetSha256
        : completedRequiredToolSetSha256 !== EMPTY_SET_SHA256 &&
          completedRequiredToolSetSha256 !== requiredToolSetSha256);
  const outcomeUnavailable =
    outcome?.status === "unavailable" || outcome?.status === "cancelled";
  const inconclusive =
    schemaVersion >= 2 &&
    ((outcome?.status === "cancelled" && value["runStatus"] === "cancelled") ||
      (outcomeUnavailable &&
        diagnosticsArray?.length === 1 &&
        diagnosticsArray[0] === "outcome_test_unavailable"));
  return (
    value["kind"] === "napier.coding-benchmark-evaluation" &&
    resourceId(value["caseId"]) &&
    isSha256(value["caseSha256"]) &&
    (value["status"] === "passed" ||
      value["status"] === "failed" ||
      (schemaVersion >= 2 && value["status"] === "inconclusive")) &&
    terminalRunStatus(value["runStatus"]) &&
    SHA256_KEYS.every((key) => isSha256(value[key])) &&
    nonNegativeInteger(value["changedFileCount"]) &&
    typeof value["targetSemanticMatch"] === "boolean" &&
    typeof value["allowedChangeSetMatch"] === "boolean" &&
    Array.isArray(diagnostics) &&
    diagnostics.length <= diagnosticSet.size &&
    new Set(diagnostics).size === diagnostics.length &&
    diagnostics.every(
      (diagnostic) =>
        typeof diagnostic === "string" && diagnosticSet.has(diagnostic),
    ) &&
    (schemaVersion === 1 || outcome !== undefined) &&
    (schemaVersion < 2 ||
      outcome?.passed === true ||
      (outcomeUnavailable
        ? diagnostics.includes("outcome_test_unavailable")
        : diagnostics.includes("outcome_test_failed"))) &&
    (schemaVersion !== 3 ||
      (requiredToolCount !== undefined &&
        requiredToolCount >= 1 &&
        completedRequiredToolCount !== undefined &&
        completedRequiredToolCount <= requiredToolCount &&
        toolSetCountsMatch &&
        diagnostics.includes("required_tool_missing") ===
          requiredToolMissing)) &&
    (value["status"] === "passed") === (diagnostics.length === 0) &&
    (value["status"] === "inconclusive") === inconclusive &&
    (value["status"] !== "failed" ||
      (diagnostics.length > 0 && !inconclusive)) &&
    (value["status"] !== "passed" ||
      (value["runStatus"] === "completed" &&
        (schemaVersion === 1
          ? value["targetSemanticMatch"] === true
          : outcome?.passed === true) &&
        value["allowedChangeSetMatch"] === true &&
        (schemaVersion !== 3 || requiredToolMissing === false) &&
        Number(value["changedFileCount"]) >= 1))
  );
}

function validOutcome(
  value: unknown,
): value is CodingBenchmarkOutcomeTestEvidence {
  if (!exactRecord(value, OUTCOME_KEYS)) return false;
  const status = value["status"];
  return (
    isSha256(value["testSha256"]) &&
    [
      "succeeded",
      "failed",
      "timed_out",
      "output_capped",
      "unavailable",
      "cancelled",
    ].includes(String(status)) &&
    boundedText(value["sandboxId"], 1, 64) &&
    isSha256(value["resultSha256"]) &&
    nonNegativeNumber(value["durationMs"]) &&
    (value["exitCode"] === null ||
      (Number.isSafeInteger(value["exitCode"]) &&
        Number(value["exitCode"]) >= 0)) &&
    isSha256(value["stdoutSha256"]) &&
    isSha256(value["stderrSha256"]) &&
    typeof value["passed"] === "boolean" &&
    value["passed"] === (status === "succeeded")
  );
}

function terminalRunStatus(value: unknown): value is RunStatus {
  return (
    typeof value === "string" && TERMINAL_RUN_STATUSES.has(value as RunStatus)
  );
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && RESOURCE_ID.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
