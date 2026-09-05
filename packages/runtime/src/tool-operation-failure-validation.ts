import type { JsonValue } from "@napier/contracts";

import {
  failureRecord,
  TOOL_FAILURE_SHA256,
} from "./tool-failure-receipt-support.js";
import {
  TOOL_FAILURE_CLASSES,
  TOOL_FAILURE_DISPOSITIONS,
  TOOL_FAILURE_SCOPES,
} from "./tool-failure-vocabulary.js";

export function validToolOperationFailure(
  value: JsonValue | undefined,
): boolean {
  if (value === undefined) return true;
  const candidate = failureRecord(value) as
    | Record<string, JsonValue>
    | undefined;
  if (!candidate || !validCommonFailure(candidate)) return false;
  // Historical operation receipts predate typed Tool failure evidence.
  if (candidate["kind"] === undefined) return true;
  const coverage = candidate["coverage"];
  return (
    candidate["kind"] === "napier.tool-failure-semantics" &&
    candidate["schemaVersion"] === 1 &&
    (coverage === "trusted_declared" ||
      coverage === "legacy_fallback" ||
      coverage === "invalid_declared") &&
    validHash(candidate["failureDefinitionSha256"]) &&
    optionalHash(candidate["bindingSha256"]) &&
    (candidate["scope"] === "invocation" ||
      coverage !== "trusted_declared" ||
      validHash(candidate["bindingSha256"])) &&
    optionalNonNegativeInteger(candidate["retryAfterMs"]) &&
    optionalHash(candidate["classificationErrorSha256"]) &&
    (coverage !== "trusted_declared" || boundedModeId(candidate["modeId"])) &&
    (coverage !== "invalid_declared" || invalidDeclaredFailure(candidate))
  );
}

function invalidDeclaredFailure(candidate: Record<string, JsonValue>): boolean {
  return (
    candidate["class"] === "unknown" &&
    candidate["scope"] === "invocation" &&
    candidate["disposition"] === "terminal" &&
    candidate["fatalToSession"] === false &&
    validHash(candidate["classificationErrorSha256"])
  );
}

function validCommonFailure(candidate: Record<string, JsonValue>): boolean {
  return (
    TOOL_FAILURE_CLASSES.has(candidate["class"] as never) &&
    TOOL_FAILURE_SCOPES.has(candidate["scope"] as never) &&
    TOOL_FAILURE_DISPOSITIONS.has(candidate["disposition"] as never) &&
    typeof candidate["fatalToSession"] === "boolean" &&
    (!candidate["fatalToSession"] || candidate["scope"] === "session") &&
    validHash(candidate["diagnosticSha256"])
  );
}

function optionalHash(value: JsonValue | undefined): boolean {
  return value === undefined || validHash(value);
}

function optionalNonNegativeInteger(value: JsonValue | undefined): boolean {
  return (
    value === undefined || (Number.isSafeInteger(value) && Number(value) >= 0)
  );
}

function boundedModeId(value: JsonValue | undefined): boolean {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/u.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && TOOL_FAILURE_SHA256.test(value);
}
