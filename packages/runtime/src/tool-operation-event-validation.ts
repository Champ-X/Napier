import type { JsonObject, JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  toolOperationDescriptorSha256,
  toolOperationId,
} from "./tool-operation-identity.js";
import { validToolOperationFailure } from "./tool-operation-failure-validation.js";
import { TOOL_FAILURE_SCOPES as FAILURE_SCOPES } from "./tool-failure-vocabulary.js";

export type ToolOperationEventType =
  | "tool.operation.proposed"
  | "tool.operation.admitted"
  | "tool.operation.effect_indeterminate"
  | "tool.operation.lease.granted"
  | "tool.operation.lease.renewed"
  | "tool.operation.started"
  | "tool.operation.settled";

const HASH = /^[a-f0-9]{64}$/u;
const OPERATIONS = new Set([
  "acquire",
  "reuse",
  "observe",
  "mutate",
  "verify",
  "coordinate",
  "neutral",
]);
const SCOPES = new Set([
  "external",
  "run_source",
  "workspace",
  "session",
  "remote",
  "control",
  "neutral",
]);
const CONTRIBUTIONS = new Set([
  "supporting",
  "product",
  "verification",
  "control",
  "neutral",
]);
const COMMON_KEYS = [
  "kind",
  "schemaVersion",
  "parentCallId",
  "operationId",
  "role",
  "startedTakeover",
  "ordinal",
  "mode",
  "route",
  "operation",
  "scope",
  "contribution",
  "resourceKeySha256",
  "failureBindings",
  "failureDefinitionSha256",
  "failureDomainKeySha256",
  "descriptorSha256",
  "phaseStateSha256",
] as const;
const ADMISSION_KEYS = [
  "admission",
  "admissionSource",
  "failure",
  "circuitKeySha256",
  "circuitScope",
  "circuitStatus",
  "circuitEpoch",
  "circuitPolicySha256",
  "circuitThroughSeq",
  "circuitAsOfMs",
  "circuitRetryAfterMs",
  "circuitProbeKeySha256",
  "circuitProbeEpoch",
  "circuitProbeRecoveryEpoch",
  "executionLeaseOwnerSha256",
  "executionLeaseGeneration",
  "executionLeaseAcquiredAtMs",
  "executionLeaseExpiresAtMs",
  "executionLeaseDisposition",
  "executionLeasePreviousGeneration",
] as const;
const LEASE_KEYS = [
  "executionLeaseOwnerSha256",
  "executionLeaseGeneration",
  "executionLeaseAcquiredAtMs",
  "executionLeaseExpiresAtMs",
  "executionLeaseDisposition",
  "executionLeasePreviousGeneration",
] as const;
const LEASE_RENEWAL_KEYS = [...LEASE_KEYS, "executionEffectBoundary"] as const;
const STARTED_KEYS = [
  "executionLeaseOwnerSha256",
  "executionLeaseGeneration",
] as const;
const EFFECT_INDETERMINATE_KEYS = [
  "disposition",
  "effectBoundaryEventSeq",
  "executionLeaseOwnerSha256",
  "executionLeaseGeneration",
  "recoveryRunLeaseBindingSha256",
  "recoveryDisposition",
  "recoveredAtMs",
] as const;
const SETTLEMENT_KEYS = [
  "outcome",
  "effectSha256",
  "stateSha256",
  "failure",
  "resultEvidenceSha256",
  "resultEvidenceEventSeq",
  "executionLeaseOwnerSha256",
  "executionLeaseGeneration",
] as const;

export function validToolOperationEventPayload(
  type: ToolOperationEventType,
  payload: JsonValue,
): payload is JsonObject {
  if (
    !isJsonObject(payload) ||
    !hasExactPhaseKeys(type, payload) ||
    !validCommonPayload(payload) ||
    !validDescriptorHash(payload) ||
    !validPhaseStateHash(type, payload)
  ) {
    return false;
  }
  if (type === "tool.operation.admitted") {
    return validAdmissionPayload(payload);
  }
  if (type === "tool.operation.lease.granted") {
    return validExecutionLease(payload, "takeover");
  }
  if (type === "tool.operation.lease.renewed") {
    return (
      validExecutionLease(payload, "renewal") &&
      (payload["executionEffectBoundary"] === undefined ||
        (payload["executionEffectBoundary"] === true &&
          payload["role"] === "execution_authority"))
    );
  }
  if (type === "tool.operation.started") {
    return validExecutionLeaseToken(payload, false);
  }
  if (type === "tool.operation.effect_indeterminate") {
    return validEffectIndeterminatePayload(payload);
  }
  if (type === "tool.operation.settled") {
    return validSettlementPayload(payload);
  }
  return true;
}

function hasExactPhaseKeys(
  type: ToolOperationEventType,
  payload: JsonObject,
): boolean {
  const phaseKeys = toolOperationPhaseKeys(type);
  const allowed = new Set<string>([...COMMON_KEYS, ...phaseKeys]);
  return Object.keys(payload).every((key) => allowed.has(key));
}

function validCommonPayload(payload: JsonObject): boolean {
  const requiredText = [
    "parentCallId",
    "operationId",
    "mode",
    "route",
    "operation",
    "scope",
    "contribution",
  ];
  const requiredHashes = [
    "resourceKeySha256",
    "failureDomainKeySha256",
    "descriptorSha256",
    "phaseStateSha256",
  ];
  return (
    payload["kind"] === "napier.tool-operation" &&
    payload["schemaVersion"] === 1 &&
    (payload["role"] === undefined ||
      payload["role"] === "progress" ||
      payload["role"] === "execution_authority") &&
    (payload["startedTakeover"] === undefined ||
      payload["startedTakeover"] === "never" ||
      payload["startedTakeover"] === "idempotent") &&
    requiredText.every((field) => boundedText(payload[field])) &&
    OPERATIONS.has(payload["operation"] as string) &&
    SCOPES.has(payload["scope"] as string) &&
    CONTRIBUTIONS.has(payload["contribution"] as string) &&
    Number.isSafeInteger(payload["ordinal"]) &&
    Number(payload["ordinal"]) >= 1 &&
    requiredHashes.every((field) => hash(payload[field])) &&
    validFailureBindings(payload["failureBindings"]) &&
    optionalHash(payload["failureDefinitionSha256"]) &&
    optionalHash(payload["stateSha256"]) &&
    optionalHash(payload["effectSha256"]) &&
    validToolOperationFailure(payload["failure"])
  );
}

function validDescriptorHash(payload: JsonObject): boolean {
  const descriptor = {
    ...(payload["role"] === undefined ? {} : { role: payload["role"] }),
    ...(payload["startedTakeover"] === undefined
      ? {}
      : { startedTakeover: payload["startedTakeover"] }),
    ordinal: payload["ordinal"],
    mode: payload["mode"],
    route: payload["route"],
    operation: payload["operation"],
    scope: payload["scope"],
    contribution: payload["contribution"],
    resourceKeySha256: payload["resourceKeySha256"],
    ...(payload["failureBindings"] === undefined
      ? {}
      : { failureBindings: payload["failureBindings"] }),
    ...(payload["failureDefinitionSha256"] === undefined
      ? {}
      : { failureDefinitionSha256: payload["failureDefinitionSha256"] }),
    failureDomainKeySha256: payload["failureDomainKeySha256"],
  };
  return (
    payload["descriptorSha256"] === toolOperationDescriptorSha256(descriptor) &&
    payload["operationId"] ===
      toolOperationId(payload["parentCallId"] as string, descriptor)
  );
}

function validFailureBindings(value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value)) return false;
  const scopes = new Set([
    "target",
    "origin",
    "route",
    "capability",
    "session",
  ]);
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([scope, binding]) => scopes.has(scope) && hash(binding))
  );
}

function validPhaseStateHash(
  type: ToolOperationEventType,
  payload: JsonObject,
): boolean {
  const phase = type.slice("tool.operation.".length);
  const fields = Object.fromEntries(
    toolOperationPhaseKeys(type).flatMap((key) =>
      payload[key] === undefined ? [] : [[key, payload[key]]],
    ),
  );
  return (
    payload["phaseStateSha256"] ===
    sha256(
      canonicalJson({
        descriptorSha256: payload["descriptorSha256"],
        phase,
        ...fields,
      }),
    )
  );
}

function toolOperationPhaseKeys(
  type: ToolOperationEventType,
): readonly string[] {
  if (type === "tool.operation.admitted") return ADMISSION_KEYS;
  if (type === "tool.operation.effect_indeterminate")
    return EFFECT_INDETERMINATE_KEYS;
  if (type === "tool.operation.lease.granted") return LEASE_KEYS;
  if (type === "tool.operation.lease.renewed") return LEASE_RENEWAL_KEYS;
  if (type === "tool.operation.started") return STARTED_KEYS;
  if (type === "tool.operation.settled") return SETTLEMENT_KEYS;
  return [];
}

function validEffectIndeterminatePayload(payload: JsonObject): boolean {
  return (
    payload["disposition"] === "effect_indeterminate" &&
    positiveInteger(payload["effectBoundaryEventSeq"]) &&
    validExecutionLeaseToken(payload, false) &&
    hash(payload["recoveryRunLeaseBindingSha256"]) &&
    (payload["recoveryDisposition"] === "run_lease_expired" ||
      payload["recoveryDisposition"] === "run_owner_unavailable" ||
      payload["recoveryDisposition"] === "run_lease_missing") &&
    nonNegativeInteger(payload["recoveredAtMs"])
  );
}

function validAdmissionPayload(payload: JsonObject): boolean {
  const admission = payload["admission"];
  if (admission !== "admitted" && admission !== "rejected") return false;
  if ((admission === "rejected") !== (payload["failure"] !== undefined)) {
    return false;
  }
  const source = payload["admissionSource"] ?? "caller";
  if (source === "failure_circuit") {
    return validCircuitRejection(payload) && hasNoExecutionLease(payload);
  }
  return (
    source === "caller" &&
    !hasCircuitRejectionReceipt(payload) &&
    validProbeReceipt(payload) &&
    (admission === "admitted"
      ? validExecutionLease(payload, "initial")
      : hasNoExecutionLease(payload))
  );
}

function validProbeReceipt(payload: JsonObject): boolean {
  const values = [
    payload["circuitProbeKeySha256"],
    payload["circuitProbeEpoch"],
    payload["circuitProbeRecoveryEpoch"],
  ];
  if (values.every((value) => value === undefined)) return true;
  return (
    payload["admission"] === "admitted" &&
    hash(values[0]) &&
    nonNegativeInteger(values[1]) &&
    nonNegativeInteger(values[2])
  );
}

function validCircuitRejection(payload: JsonObject): boolean {
  return (
    payload["admission"] === "rejected" &&
    hash(payload["circuitKeySha256"]) &&
    hash(payload["circuitPolicySha256"]) &&
    FAILURE_SCOPES.has(payload["circuitScope"] as never) &&
    payload["circuitStatus"] === "open" &&
    nonNegativeInteger(payload["circuitEpoch"]) &&
    nonNegativeInteger(payload["circuitThroughSeq"]) &&
    nonNegativeInteger(payload["circuitAsOfMs"]) &&
    optionalNonNegativeInteger(payload["circuitRetryAfterMs"])
  );
}

function validSettlementPayload(payload: JsonObject): boolean {
  const outcome = payload["outcome"];
  const hasRecoveryEvidence = payload["resultEvidenceSha256"] !== undefined;
  return (
    (outcome === "succeeded" ||
      outcome === "failed" ||
      outcome === "skipped") &&
    hash(payload["effectSha256"]) &&
    optionalHash(payload["resultEvidenceSha256"]) &&
    hasRecoveryEvidence === (payload["resultEvidenceEventSeq"] !== undefined) &&
    (!hasRecoveryEvidence ||
      positiveInteger(payload["resultEvidenceEventSeq"])) &&
    (outcome !== "succeeded") === (payload["failure"] !== undefined) &&
    validExecutionLeaseToken(payload, true)
  );
}

function validExecutionLease(
  payload: JsonObject,
  kind: "initial" | "renewal" | "takeover",
): boolean {
  const generation = payload["executionLeaseGeneration"];
  const acquiredAtMs = payload["executionLeaseAcquiredAtMs"];
  const expiresAtMs = payload["executionLeaseExpiresAtMs"];
  const disposition = payload["executionLeaseDisposition"];
  const previousGeneration = payload["executionLeasePreviousGeneration"];
  return (
    hash(payload["executionLeaseOwnerSha256"]) &&
    positiveInteger(generation) &&
    nonNegativeInteger(acquiredAtMs) &&
    nonNegativeInteger(expiresAtMs) &&
    Number(expiresAtMs) > Number(acquiredAtMs) &&
    (kind === "initial"
      ? disposition === "initial" &&
        generation === 1 &&
        previousGeneration === undefined
      : kind === "renewal"
        ? disposition === "renewal" && previousGeneration === undefined
        : (disposition === "unstarted_takeover" ||
            disposition === "safe_started_takeover") &&
          nonNegativeInteger(previousGeneration) &&
          Number(previousGeneration) === Number(generation) - 1)
  );
}

function validExecutionLeaseToken(
  payload: JsonObject,
  optional: boolean,
): boolean {
  const owner = payload["executionLeaseOwnerSha256"];
  const generation = payload["executionLeaseGeneration"];
  if (optional && owner === undefined && generation === undefined) return true;
  return hash(owner) && positiveInteger(generation);
}

function hasNoExecutionLease(payload: JsonObject): boolean {
  return LEASE_KEYS.every((key) => payload[key] === undefined);
}

const CIRCUIT_RECEIPT_FIELDS = [
  "circuitKeySha256",
  "circuitScope",
  "circuitStatus",
  "circuitEpoch",
  "circuitPolicySha256",
  "circuitThroughSeq",
  "circuitAsOfMs",
  "circuitRetryAfterMs",
];

function hasCircuitRejectionReceipt(payload: JsonObject): boolean {
  return CIRCUIT_RECEIPT_FIELDS.some((field) => payload[field] !== undefined);
}

function boundedText(value: JsonValue | undefined): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function hash(value: JsonValue | undefined): value is string {
  return typeof value === "string" && HASH.test(value);
}

function optionalHash(value: JsonValue | undefined): boolean {
  return value === undefined || hash(value);
}

function nonNegativeInteger(value: JsonValue | undefined): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: JsonValue | undefined): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function optionalNonNegativeInteger(value: JsonValue | undefined): boolean {
  return value === undefined || nonNegativeInteger(value);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
