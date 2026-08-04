import type { RunEvent } from "@napier/contracts";

import type {
  ProcessRecoveryBenchmarkEvaluation,
  ProcessRecoveryBenchmarkLedger,
  ProcessRecoveryBenchmarkResult,
} from "./process-recovery-benchmark-types.js";

export function validProcessRecoveryResultIdentity(
  value: ProcessRecoveryBenchmarkResult,
): boolean {
  return (
    validResultHeader(value) &&
    validExecutorIdentity(value.executor) &&
    validEnvironmentIdentity(value.environment) &&
    validRunIdentity(value.run) &&
    validEvaluationIdentity(value.evaluation) &&
    validLedgerReference(value.ledger)
  );
}

export function validProcessRecoveryBundleIdentity(
  value: ProcessRecoveryBenchmarkLedger,
): boolean {
  return (
    validBundleHeader(value) &&
    validPreviewProjection(value.preview) &&
    validProcessProjection(value.process) &&
    validTargetProjection(value.target) &&
    validBundleEvents(value)
  );
}

function validResultHeader(value: ProcessRecoveryBenchmarkResult): boolean {
  return (
    value.kind === "napier.process-recovery-benchmark-result" &&
    value.schemaVersion === 1 &&
    isoDate(value.generatedAt) &&
    resourceId(value.caseId) &&
    digest(value.caseSha256) &&
    digest(value.contentSha256) &&
    (value.status === "passed" ||
      value.status === "failed" ||
      value.status === "inconclusive")
  );
}

function validExecutorIdentity(value: unknown): boolean {
  return (
    record(value) &&
    value["kind"] === "napier" &&
    value["capability"] === "workspace_process" &&
    boundedText(value["sandboxId"], 1, 200) &&
    (value["sandboxBoundary"] === "platform" ||
      value["sandboxBoundary"] === "trusted_outer_test")
  );
}

function validEnvironmentIdentity(value: unknown): boolean {
  return (
    record(value) &&
    boundedText(value["nodeVersion"], 1, 80) &&
    boundedText(value["platform"], 1, 40) &&
    boundedText(value["arch"], 1, 40) &&
    boundedText(value["cliVersion"], 1, 40)
  );
}

function validRunIdentity(value: unknown): boolean {
  return (
    record(value) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    processId(value["processId"]) &&
    boundedInteger(value["durationMs"], 0, 120_000)
  );
}

function validLedgerReference(value: unknown): boolean {
  return (
    record(value) &&
    boundedText(value["bundleFileName"], 1, 400) &&
    digest(value["bundleSha256"]) &&
    boundedInteger(value["bundleBytes"], 1, 4 * 1024 * 1024)
  );
}

function validBundleHeader(value: ProcessRecoveryBenchmarkLedger): boolean {
  return (
    value.kind === "napier.process-recovery-benchmark-ledger" &&
    value.schemaVersion === 1 &&
    isoDate(value.generatedAt) &&
    resourceId(value.caseId) &&
    digest(value.caseSha256) &&
    digest(value.contentSha256) &&
    resourceId(value.threadId) &&
    resourceId(value.runId) &&
    processId(value.processId) &&
    digest(value.sourceReplaySha256) &&
    digest(value.receiptSetSha256)
  );
}

function validBundleEvents(value: ProcessRecoveryBenchmarkLedger): boolean {
  return (
    Array.isArray(value.processEvents) &&
    value.processEvents.every(validRunEvent) &&
    Array.isArray(value.eventReceipts) &&
    value.eventReceipts.every(validEventReceipt) &&
    boundedInteger(value.eventCount, value.processEvents.length + 1, 100_000) &&
    validRunEvent(value.evaluationEvent) &&
    value.evaluationEvent.type === "benchmark.process.recovery.evaluated"
  );
}

function validEvaluationIdentity(
  value: unknown,
): value is ProcessRecoveryBenchmarkEvaluation {
  if (!record(value)) return false;
  const evaluation = value as unknown as ProcessRecoveryBenchmarkEvaluation;
  return (
    evaluation.kind === "napier.process-recovery-benchmark-evaluation" &&
    evaluation.schemaVersion === 1 &&
    resourceId(evaluation.caseId) &&
    digest(evaluation.caseSha256) &&
    digest(evaluation.contentSha256) &&
    (evaluation.status === "passed" ||
      evaluation.status === "failed" ||
      evaluation.status === "inconclusive") &&
    boundedText(evaluation.sandboxId, 1, 200) &&
    (evaluation.sandboxBoundary === "platform" ||
      evaluation.sandboxBoundary === "trusted_outer_test") &&
    Number.isSafeInteger(evaluation.processSchemaVersion) &&
    typeof evaluation.processStatus === "string" &&
    (evaluation.processExitCode === null ||
      Number.isSafeInteger(evaluation.processExitCode)) &&
    typeof evaluation.workspaceDeltaStatus === "string" &&
    typeof evaluation.workspaceWriteScopeStatus === "string" &&
    typeof evaluation.workspaceCompensationStatus === "string" &&
    [
      evaluation.workspaceRollbackAvailable,
      evaluation.targetRestored,
      evaluation.recoverySnapshotPresent,
      evaluation.processEventOrderValid,
      evaluation.recoveredAfterReopen,
      evaluation.replayValid,
    ].every((item) => typeof item === "boolean") &&
    boundedInteger(evaluation.processEventCount, 0, 16) &&
    Array.isArray(evaluation.diagnostics) &&
    evaluation.diagnostics.every(
      (diagnostic) =>
        typeof diagnostic === "string" && diagnostic.length <= 100,
    )
  );
}

function validPreviewProjection(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    Number.isSafeInteger(value["schemaVersion"]) &&
    boundedText(value["sandbox"], 1, 200) &&
    [
      "commandSha256",
      "executableSha256",
      "environmentSha256",
      "resourceLimitsSha256",
      "writeScopeSetSha256",
      "workspaceBeforeSha256",
      "contentSha256",
    ].every((key) => digest(value[key])) &&
    boundedInteger(value["writeScopeCount"], 1, 8) &&
    boundedInteger(value["workspaceBeforeFileCount"], 0, 10_000) &&
    boundedInteger(value["workspaceBeforeBytes"], 0, 64 * 1024 * 1024) &&
    value["failureRecovery"] === "restore_scopes"
  );
}

function validProcessProjection(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    Number.isSafeInteger(value["schemaVersion"]) &&
    boundedText(value["sandbox"], 1, 200) &&
    typeof value["status"] === "string" &&
    (value["exitCode"] === null || Number.isSafeInteger(value["exitCode"])) &&
    digest(value["contentSha256"])
  );
}

function validTargetProjection(value: unknown): boolean {
  return (
    record(value) &&
    digest(value["initialSha256"]) &&
    digest(value["mutatedSha256"]) &&
    digest(value["finalSha256"]) &&
    typeof value["restored"] === "boolean"
  );
}

function validRunEvent(value: unknown): value is RunEvent {
  if (!record(value)) return false;
  return (
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    boundedInteger(value["seq"], 1, Number.MAX_SAFE_INTEGER) &&
    boundedText(value["type"], 1, 200) &&
    typeof value["category"] === "string" &&
    typeof value["visibility"] === "string" &&
    isoDate(value["createdAt"]) &&
    Object.hasOwn(value, "payload")
  );
}

function validEventReceipt(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    resourceId(value["id"]) &&
    boundedInteger(value["seq"], 1, Number.MAX_SAFE_INTEGER) &&
    resourceId(value["runId"]) &&
    boundedText(value["type"], 1, 200) &&
    typeof value["category"] === "string" &&
    typeof value["visibility"] === "string" &&
    isoDate(value["createdAt"]) &&
    digest(value["payloadSha256"]) &&
    digest(value["previousReceiptSha256"]) &&
    digest(value["receiptSha256"])
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function processId(value: unknown): value is string {
  return typeof value === "string" && /^process_[a-z0-9]{8,80}$/u.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function boundedText(
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

function boundedInteger(
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

function isoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
