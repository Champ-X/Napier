import { parseBrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";

import { validBrowserConfirmedFormRunEvent } from "./browser-confirmed-form-benchmark-event-shape.js";

const RESULT_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 status model environment run execution evaluation ledger contentSha256",
);
const LEDGER_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId runId model expectedAssistantSha256 actualAssistantSha256 expectedOutcomeUrlSha256 expectedOutcomeTitleSha256 expectedConfirmationActions expectedConfirmationEffects maxDurationMs credentialVariableSha256 run execution evidenceEvents confirmations browserOperations replayValid credentialReferenceCount credentialProviderMatch credentialLocatorMatch credentialAvailable credentialLeakDetected credentialPersistenceLeakDetected privateValueLeakDetected evaluationEvent terminalEvent eventCount sourceEventStreamSha256 sourceReplaySha256 eventReceipts receiptSetSha256 contentSha256",
);
const SERIES_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 model environment status requestedTrialCount completedTrialCount passedTrialCount failedTrialCount inconclusiveTrialCount completionRate passRate metrics trials contentSha256",
);
const MODEL_KEYS = keySet("provider id");
const ENVIRONMENT_KEYS = keySet("nodeVersion platform arch cliVersion");
const RUN_KEYS = keySet("threadId runId status durationMs usage");
const USAGE_KEYS = keySet(
  "inputTokens outputTokens cacheReadTokens cacheWriteTokens costUsd",
);
const EXECUTION_KEYS = keySet(
  "entry cliExitCode confirmationPromptCount approvalInputCount unexpectedConfirmationAction firstConfirmationMs totalDurationMs terminalOutputSha256 terminalOutputBytes",
);
const EVALUATION_KEYS = keySet(
  "kind schemaVersion caseId caseSha256 status runStatus cliExitCode assistantOutputMatch confirmationPromptCount approvalInputCount confirmationEventCount confirmationOrderValid confirmationActions confirmationEffects browserActions browserWriteActions browserOperationOrderValid browserOutcomeUrlMatch browserOutcomeTitleMatch browserSingleSession firstConfirmationMs totalDurationMs maxDurationMs credentialReferenceCount credentialProviderMatch credentialLocatorMatch credentialAvailable replayValid credentialLeakDetected credentialPersistenceLeakDetected privateValueLeakDetected diagnostics contentSha256",
);
const LEDGER_REFERENCE_KEYS = keySet("bundleFileName bundleSha256 bundleBytes");
const OPERATION_REQUIRED_KEYS = keySet(
  "eventId eventSeq eventType payloadSha256 action status",
);
const OPERATION_OPTIONAL_KEYS = keySet(
  "sessionOperation sessionIdSha256 currentUrlSha256 titleSha256",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);
const METRICS_KEYS = keySet("firstConfirmationMs totalDurationMs costUsd");
const METRIC_KEYS = keySet("total min p50 p95 max mean");
const TRIAL_KEYS = keySet(
  "index threadId runId status resultFileName resultSha256 ledgerFileName ledgerSha256",
);

export function validBrowserConfirmedFormResultKeys(value: unknown): boolean {
  return (
    exactRecord(value, RESULT_KEYS) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    validRunKeys(value["run"]) &&
    exactRecord(value["execution"], EXECUTION_KEYS) &&
    exactRecord(value["evaluation"], EVALUATION_KEYS) &&
    exactRecord(value["ledger"], LEDGER_REFERENCE_KEYS) &&
    safeArtifactName(value["ledger"]["bundleFileName"], "ledger")
  );
}

export function validBrowserConfirmedFormLedgerKeys(value: unknown): boolean {
  if (!record(value)) return false;
  const keys =
    value["actualAssistantSha256"] === undefined
      ? LEDGER_KEYS.filter((key) => key !== "actualAssistantSha256")
      : LEDGER_KEYS;
  return (
    exactRecord(value, keys) &&
    validModel(value["model"]) &&
    validRunKeys(value["run"]) &&
    exactRecord(value["execution"], EXECUTION_KEYS) &&
    Array.isArray(value["evidenceEvents"]) &&
    value["evidenceEvents"].every(validBrowserConfirmedFormRunEvent) &&
    Array.isArray(value["confirmations"]) &&
    value["confirmations"].every(
      (confirmation) =>
        parseBrowserInteractionConfirmation(confirmation) !== undefined,
    ) &&
    Array.isArray(value["browserOperations"]) &&
    value["browserOperations"].every(validOperationKeys) &&
    validBrowserConfirmedFormRunEvent(value["evaluationEvent"]) &&
    validBrowserConfirmedFormRunEvent(value["terminalEvent"]) &&
    Array.isArray(value["eventReceipts"]) &&
    value["eventReceipts"].every((receipt) =>
      exactRecord(receipt, RECEIPT_KEYS),
    )
  );
}

export function validBrowserConfirmedFormSeriesKeys(value: unknown): boolean {
  return (
    exactRecord(value, SERIES_KEYS) &&
    validModel(value["model"]) &&
    validEnvironment(value["environment"]) &&
    exactRecord(value["metrics"], METRICS_KEYS) &&
    Object.values(value["metrics"]).every((metric) =>
      exactRecord(metric, METRIC_KEYS),
    ) &&
    Array.isArray(value["trials"]) &&
    value["trials"].every(validTrialKeys)
  );
}

function validRunKeys(value: unknown): boolean {
  return (
    exactRecord(value, RUN_KEYS) &&
    runStatus(value["status"]) &&
    exactRecord(value["usage"], USAGE_KEYS) &&
    Object.values(value["usage"]).every(nonNegativeNumber)
  );
}

function validOperationKeys(value: unknown): boolean {
  return exactOptionalRecord(
    value,
    OPERATION_REQUIRED_KEYS,
    OPERATION_OPTIONAL_KEYS,
  );
}

function validTrialKeys(value: unknown): boolean {
  return (
    exactRecord(value, TRIAL_KEYS) &&
    safeArtifactName(value["resultFileName"], "result") &&
    safeArtifactName(value["ledgerFileName"], "ledger")
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
    Object.values(value).every(
      (item) =>
        typeof item === "string" && item.length >= 1 && item.length <= 64,
    )
  );
}

function safeArtifactName(value: unknown, kind: "result" | "ledger"): boolean {
  return (
    typeof value === "string" &&
    new RegExp(
      `^napier-browser-confirmed-form-benchmark-${kind}-[a-z][a-z0-9_]{2,80}-[a-f0-9]{16}\\.json$`,
      "u",
    ).test(value)
  );
}

function nonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function runStatus(value: unknown): boolean {
  return (
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "interrupted"
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

function exactOptionalRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (!record(value) || required.some((key) => !Object.hasOwn(value, key))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
