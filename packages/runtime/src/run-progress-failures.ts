import type { JsonValue, RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const INPUT_HASH_FIELDS = [
  "inputSha256",
  "workflowInputSha256",
  "argumentsSha256",
] as const;
const VOLATILE_FIELDS = new Set([
  "callId",
  "status",
  "outputTextBytes",
  "workflowAttempt",
]);

export function runProgressToolInputFingerprint(
  payload: Record<string, JsonValue>,
): string {
  return sha256(canonicalJson(stableProjection(payload)));
}

export function runProgressFailureFingerprint(
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  toolInputs: ReadonlyMap<string, string>,
): string {
  const callId = text(payload?.["callId"]);
  const inputBinding =
    INPUT_HASH_FIELDS.map((field) => text(payload?.[field])).find(hash) ??
    (callId ? toolInputs.get(callId) : undefined) ??
    (payload ? sha256(canonicalJson(stableProjection(payload))) : "");
  const policyReason = text(payload?.["policyReason"]);
  return sha256(
    canonicalJson({
      type: event.type,
      toolName: text(payload?.["toolName"]) ?? "",
      inputBinding,
      errorCode: text(payload?.["errorCode"]) ?? "",
      policyReasonSha256: policyReason ? sha256(policyReason) : "",
    }),
  );
}

export function runProgressFailureDomainFingerprint(
  event: RunEvent,
  payload: Record<string, JsonValue> | undefined,
  toolInputs: ReadonlyMap<string, string>,
): string {
  const callId = text(payload?.["callId"]);
  const progress = record(record(payload?.["toolProtocol"])?.["progress"]);
  const failure = record(payload?.["toolFailure"]);
  const resourceKey = hashText(progress?.["resourceKeySha256"]);
  const failureBindings = record(progress?.["failureBindings"]);
  const failureDomainKey = hashText(progress?.["failureDomainKeySha256"]);
  const failureScope = text(failure?.["scope"]);
  const scopedFailureBinding = failureScopeBinding(
    failureScope,
    failureBindings,
    resourceKey,
    failureDomainKey,
  );
  const scopeBinding =
    scopedFailureBinding ??
    resourceKey ??
    failureDomainKey ??
    INPUT_HASH_FIELDS.map((field) => text(payload?.[field])).find(hash) ??
    (callId ? toolInputs.get(callId) : undefined) ??
    "";
  return sha256(
    canonicalJson({
      disposition:
        text(failure?.["disposition"]) ??
        (event.type === "tool.blocked" ? "terminal" : "alternate_route"),
      operation: text(progress?.["operation"]) ?? "unknown",
      scope:
        failureScope ??
        defaultFailureScope(resourceKey, failureBindings, failureDomainKey),
      scopeBinding,
      failureClass:
        text(failure?.["class"]) ??
        text(payload?.["failureClass"]) ??
        text(payload?.["errorCode"]) ??
        (event.type === "tool.blocked" ? "policy" : "unknown"),
    }),
  );
}

function failureScopeBinding(
  scope: string | undefined,
  bindings: Record<string, JsonValue> | undefined,
  resourceKey: string | undefined,
  legacyDomain: string | undefined,
): string | undefined {
  if (scope === "target") return hashText(bindings?.[scope]) ?? resourceKey;
  if (!isDomainScope(scope)) return undefined;
  return hashText(bindings?.[scope]) ?? legacyDomain;
}

function defaultFailureScope(
  resourceKey: string | undefined,
  bindings: Record<string, JsonValue> | undefined,
  legacyDomain: string | undefined,
): "target" | "origin" | "invocation" {
  if (resourceKey) return "target";
  return bindings?.["origin"] || legacyDomain ? "origin" : "invocation";
}

function isDomainScope(
  value: string | undefined,
): value is "origin" | "route" | "capability" | "session" {
  return (
    value === "origin" ||
    value === "route" ||
    value === "capability" ||
    value === "session"
  );
}

function stableProjection(
  payload: Record<string, JsonValue>,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(payload).filter(([field]) => !VOLATILE_FIELDS.has(field)),
  );
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function hashText(value: JsonValue | undefined): string | undefined {
  const candidate = text(value);
  return candidate && hash(candidate) ? candidate : undefined;
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function hash(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/u.test(value));
}
