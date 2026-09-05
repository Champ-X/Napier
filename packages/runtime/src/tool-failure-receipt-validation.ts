import type {
  ToolFailureClassV1,
  ToolFailureDispositionV1,
  ToolFailureReceiptV1,
  ToolFailureScopeV1,
} from "@napier/contracts/tool-protocol";

import {
  failureDiagnosticSha256,
  failureRecord,
  TOOL_FAILURE_SHA256,
} from "./tool-failure-receipt-support.js";
import {
  TOOL_FAILURE_CLASSES,
  TOOL_FAILURE_DISPOSITIONS,
  TOOL_FAILURE_SCOPES,
} from "./tool-failure-vocabulary.js";
import { sha256 } from "./ed25519.js";

export function isToolFailureReceiptV1(
  value: unknown,
): value is ToolFailureReceiptV1 {
  const candidate = failureRecord(value);
  if (!candidate) return false;
  const coverage = candidate["coverage"];
  const scope = candidate["scope"];
  return (
    validIdentity(candidate, coverage) &&
    validSemantics(candidate, scope) &&
    validReceiptHashes(candidate) &&
    validCoverageSemantics(candidate, coverage, scope) &&
    validRetry(candidate["retryAfterMs"])
  );
}

function validIdentity(
  candidate: Record<string, unknown>,
  coverage: unknown,
): boolean {
  return (
    candidate["kind"] === "napier.tool-failure-semantics" &&
    candidate["schemaVersion"] === 1 &&
    (coverage === "trusted_declared" ||
      coverage === "legacy_fallback" ||
      coverage === "invalid_declared")
  );
}

function validSemantics(
  candidate: Record<string, unknown>,
  scope: unknown,
): boolean {
  return (
    TOOL_FAILURE_CLASSES.has(candidate["class"] as ToolFailureClassV1) &&
    TOOL_FAILURE_SCOPES.has(scope as ToolFailureScopeV1) &&
    TOOL_FAILURE_DISPOSITIONS.has(
      candidate["disposition"] as ToolFailureDispositionV1,
    ) &&
    typeof candidate["fatalToSession"] === "boolean" &&
    (!candidate["fatalToSession"] || scope === "session")
  );
}

function validReceiptHashes(candidate: Record<string, unknown>): boolean {
  return (
    validHash(candidate["failureDefinitionSha256"]) &&
    validHash(candidate["diagnosticSha256"]) &&
    optionalHash(candidate["bindingSha256"]) &&
    optionalHash(candidate["classificationErrorSha256"])
  );
}

function validCoverageSemantics(
  candidate: Record<string, unknown>,
  coverage: unknown,
  scope: unknown,
): boolean {
  if (
    coverage === "trusted_declared" &&
    scope !== "invocation" &&
    !validHash(candidate["bindingSha256"])
  ) {
    return false;
  }
  if (
    coverage === "trusted_declared" &&
    (typeof candidate["modeId"] !== "string" ||
      !/^[a-z][a-z0-9_.-]{0,63}$/u.test(candidate["modeId"]))
  ) {
    return false;
  }
  return (
    coverage !== "invalid_declared" ||
    (candidate["class"] === "unknown" &&
      scope === "invocation" &&
      candidate["disposition"] === "terminal" &&
      candidate["fatalToSession"] === false &&
      validHash(candidate["classificationErrorSha256"]))
  );
}

function validRetry(value: unknown): boolean {
  return (
    value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
  );
}

/** Malformed typed evidence never re-enters legacy text classification. */
export function normalizeToolFailureReceipt(
  value: unknown,
  diagnostic: unknown,
): ToolFailureReceiptV1 {
  if (isToolFailureReceiptV1(value)) return Object.freeze({ ...value });
  const candidate = failureRecord(value);
  const claimedDefinition = candidate?.["failureDefinitionSha256"];
  const failureDefinitionSha256 = validHash(claimedDefinition)
    ? claimedDefinition
    : sha256("napier.invalid-tool-failure-definition");
  return Object.freeze({
    kind: "napier.tool-failure-semantics" as const,
    schemaVersion: 1 as const,
    coverage: "invalid_declared" as const,
    class: "unknown" as const,
    scope: "invocation" as const,
    disposition: "terminal" as const,
    fatalToSession: false,
    failureDefinitionSha256,
    diagnosticSha256: failureDiagnosticSha256(diagnostic),
    classificationErrorSha256: failureDiagnosticSha256(value),
  });
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && TOOL_FAILURE_SHA256.test(value);
}

function optionalHash(value: unknown): boolean {
  return value === undefined || validHash(value);
}
