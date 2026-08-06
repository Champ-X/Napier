import type { RunEvent } from "@napier/contracts";
import { parseBrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";

import type {
  BrowserConfirmedFormBenchmarkEvaluation,
  BrowserConfirmedFormBenchmarkLedger,
  BrowserConfirmedFormBenchmarkResult,
} from "./browser-confirmed-form-benchmark-types.js";
import {
  validBrowserConfirmedFormLedgerKeys,
  validBrowserConfirmedFormResultKeys,
} from "./browser-confirmed-form-benchmark-strict-shape.js";

export function validBrowserConfirmedFormResultShape(
  value: unknown,
): value is BrowserConfirmedFormBenchmarkResult {
  if (!record(value) || !validBrowserConfirmedFormResultKeys(value)) {
    return false;
  }
  const result = value as unknown as BrowserConfirmedFormBenchmarkResult;
  return (
    validResultHeader(result) &&
    record(result.model) &&
    record(result.environment) &&
    validRun(result.run) &&
    validExecution(result.execution) &&
    validEvaluationShape(result.evaluation) &&
    validLedgerReference(result.ledger)
  );
}

export function validBrowserConfirmedFormLedgerShape(
  value: unknown,
): value is BrowserConfirmedFormBenchmarkLedger {
  if (!record(value) || !validBrowserConfirmedFormLedgerKeys(value)) {
    return false;
  }
  const bundle = value as unknown as BrowserConfirmedFormBenchmarkLedger;
  return (
    validLedgerHeader(bundle) &&
    validLedgerExpectations(bundle) &&
    validRun(bundle.run) &&
    validExecution(bundle.execution) &&
    validLedgerEvidence(bundle) &&
    validLedgerSecurity(bundle) &&
    validLedgerReceipts(bundle)
  );
}

function validResultHeader(
  result: BrowserConfirmedFormBenchmarkResult,
): boolean {
  return (
    result.kind === "napier.browser-confirmed-form-benchmark-result" &&
    result.schemaVersion === 1 &&
    isoDate(result.generatedAt) &&
    resourceId(result.caseId) &&
    digest(result.caseSha256) &&
    digest(result.contentSha256) &&
    ["passed", "failed", "inconclusive"].includes(result.status)
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

function validLedgerHeader(
  bundle: BrowserConfirmedFormBenchmarkLedger,
): boolean {
  return (
    bundle.kind === "napier.browser-confirmed-form-benchmark-ledger" &&
    bundle.schemaVersion === 1 &&
    isoDate(bundle.generatedAt) &&
    resourceId(bundle.caseId) &&
    digest(bundle.caseSha256) &&
    digest(bundle.contentSha256) &&
    resourceId(bundle.threadId) &&
    resourceId(bundle.runId) &&
    record(bundle.model)
  );
}

function validLedgerExpectations(
  bundle: BrowserConfirmedFormBenchmarkLedger,
): boolean {
  return (
    digest(bundle.expectedAssistantSha256) &&
    (bundle.actualAssistantSha256 === undefined ||
      digest(bundle.actualAssistantSha256)) &&
    digest(bundle.expectedOutcomeUrlSha256) &&
    digest(bundle.expectedOutcomeTitleSha256) &&
    validActions(bundle.expectedConfirmationActions) &&
    validEffects(bundle.expectedConfirmationEffects) &&
    boundedInteger(bundle.maxDurationMs, 10_000, 180_000) &&
    digest(bundle.credentialVariableSha256)
  );
}

function validLedgerEvidence(
  bundle: BrowserConfirmedFormBenchmarkLedger,
): boolean {
  return (
    Array.isArray(bundle.evidenceEvents) &&
    bundle.evidenceEvents.every(validRunEvent) &&
    Array.isArray(bundle.confirmations) &&
    bundle.confirmations.every(
      (confirmation) =>
        parseBrowserInteractionConfirmation(confirmation) !== undefined,
    ) &&
    Array.isArray(bundle.browserOperations) &&
    bundle.browserOperations.every(validOperation) &&
    validRunEvent(bundle.evaluationEvent) &&
    validRunEvent(bundle.terminalEvent)
  );
}

function validLedgerSecurity(
  bundle: BrowserConfirmedFormBenchmarkLedger,
): boolean {
  return (
    typeof bundle.replayValid === "boolean" &&
    boundedInteger(bundle.credentialReferenceCount, 0, 16) &&
    [
      bundle.credentialProviderMatch,
      bundle.credentialLocatorMatch,
      bundle.credentialAvailable,
      bundle.credentialLeakDetected,
      bundle.credentialPersistenceLeakDetected,
      bundle.privateValueLeakDetected,
    ].every((item) => typeof item === "boolean")
  );
}

function validLedgerReceipts(
  bundle: BrowserConfirmedFormBenchmarkLedger,
): boolean {
  return (
    boundedInteger(bundle.eventCount, bundle.evidenceEvents.length, 100_000) &&
    digest(bundle.sourceEventStreamSha256) &&
    digest(bundle.sourceReplaySha256) &&
    Array.isArray(bundle.eventReceipts) &&
    bundle.eventReceipts.every(validReceipt) &&
    digest(bundle.receiptSetSha256)
  );
}

function validEvaluationShape(
  value: unknown,
): value is BrowserConfirmedFormBenchmarkEvaluation {
  if (!record(value)) return false;
  const evaluation =
    value as unknown as BrowserConfirmedFormBenchmarkEvaluation;
  return (
    evaluation.kind === "napier.browser-confirmed-form-benchmark-evaluation" &&
    evaluation.schemaVersion === 1 &&
    resourceId(evaluation.caseId) &&
    digest(evaluation.caseSha256) &&
    digest(evaluation.contentSha256) &&
    ["passed", "failed", "inconclusive"].includes(evaluation.status) &&
    boundedInteger(evaluation.confirmationEventCount, 0, 16) &&
    Array.isArray(evaluation.diagnostics)
  );
}

function validExecution(value: unknown): boolean {
  if (!record(value)) return false;
  return (
    value["entry"] === "cli_one_shot_pty" &&
    Number.isSafeInteger(value["cliExitCode"]) &&
    boundedInteger(value["confirmationPromptCount"], 0, 16) &&
    boundedInteger(value["approvalInputCount"], 0, 16) &&
    typeof value["unexpectedConfirmationAction"] === "boolean" &&
    boundedInteger(value["firstConfirmationMs"], 0, 190_000) &&
    boundedInteger(value["totalDurationMs"], 0, 190_000) &&
    digest(value["terminalOutputSha256"]) &&
    boundedInteger(value["terminalOutputBytes"], 0, 4 * 1024 * 1024)
  );
}

function validRun(value: unknown): boolean {
  return (
    record(value) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    typeof value["status"] === "string" &&
    boundedInteger(value["durationMs"], 0, 180_000) &&
    record(value["usage"])
  );
}

function validOperation(value: unknown): boolean {
  return (
    record(value) &&
    resourceId(value["eventId"]) &&
    boundedInteger(value["eventSeq"], 1, Number.MAX_SAFE_INTEGER) &&
    ["tool.blocked", "tool.completed", "tool.failed"].includes(
      String(value["eventType"]),
    ) &&
    digest(value["payloadSha256"]) &&
    boundedText(value["action"], 1, 40) &&
    ["blocked", "completed", "failed"].includes(String(value["status"]))
  );
}

function validRunEvent(value: unknown): value is RunEvent {
  return (
    record(value) &&
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

function validReceipt(value: unknown): boolean {
  return (
    record(value) &&
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

function validActions(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "type" &&
    value[1] === "click"
  );
}

function validEffects(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "data_entry" &&
    value[1] === "form_submit"
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
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
