import type {
  ToolConcurrency,
  ToolProgressContribution,
  ToolProgressOperation,
  ToolProgressReceiptV1,
  ToolProgressScope,
  ToolSideEffect,
  ToolUiProjectionV2,
} from "./tool-protocol-projection-types.js";

const PROJECTION_KEYS = [
  "kind",
  "schemaVersion",
  "toolId",
  "semanticVersion",
  "definitionSha256",
  "failureDefinitionSha256",
  "implementationSha256",
  "status",
  "sideEffect",
  "concurrency",
  "progress",
  "compatibilityMode",
] as const;
const PROGRESS_REQUIRED_KEYS = [
  "kind",
  "schemaVersion",
  "availability",
  "coverage",
  "operation",
  "scope",
  "contribution",
] as const;
const PROGRESS_OPTIONAL_KEYS = [
  "modeId",
  "resourceKeySha256",
  "failureBindings",
  "failureDomainKeySha256",
  "stateSha256",
  "classificationErrorSha256",
] as const;
const FAILURE_BINDING_KEYS = [
  "target",
  "origin",
  "route",
  "capability",
  "session",
] as const;

export interface ToolUiProjectionV2Expectation {
  toolId?: string;
  status?: ToolUiProjectionV2["status"];
}

/** Canonical structural validator for the durable Tool UI projection. */
export function isToolUiProjectionV2(
  value: unknown,
  expectation: ToolUiProjectionV2Expectation = {},
): value is ToolUiProjectionV2 {
  if (!exactRecord(value, PROJECTION_KEYS)) return false;
  return (
    value["kind"] === "napier.tool-ui-projection" &&
    value["schemaVersion"] === 2 &&
    toolId(value["toolId"]) &&
    (expectation.toolId === undefined ||
      value["toolId"] === expectation.toolId) &&
    semanticVersion(value["semanticVersion"]) &&
    sha256(value["definitionSha256"]) &&
    sha256(value["failureDefinitionSha256"]) &&
    sha256(value["implementationSha256"]) &&
    projectionStatus(value["status"]) &&
    (expectation.status === undefined ||
      value["status"] === expectation.status) &&
    sideEffect(value["sideEffect"]) &&
    concurrency(value["concurrency"]) &&
    isToolProgressReceiptV1(value["progress"]) &&
    (value["compatibilityMode"] === "native" ||
      value["compatibilityMode"] === "compatibility")
  );
}

export function isToolProgressReceiptV1(
  value: unknown,
): value is ToolProgressReceiptV1 {
  if (
    !exactOptionalRecord(value, PROGRESS_REQUIRED_KEYS, PROGRESS_OPTIONAL_KEYS)
  ) {
    return false;
  }
  return (
    value["kind"] === "napier.tool-progress-semantics" &&
    value["schemaVersion"] === 1 &&
    (value["availability"] === "declared" ||
      value["availability"] === "unavailable") &&
    (value["coverage"] === "trusted_declared" ||
      value["coverage"] === "host_observed" ||
      value["coverage"] === "opaque") &&
    progressOperation(value["operation"]) &&
    progressScope(value["scope"]) &&
    progressContribution(value["contribution"]) &&
    optionalModeId(value["modeId"]) &&
    optionalSha256(value["resourceKeySha256"]) &&
    optionalFailureBindings(value["failureBindings"]) &&
    optionalSha256(value["failureDomainKeySha256"]) &&
    optionalSha256(value["stateSha256"]) &&
    optionalSha256(value["classificationErrorSha256"])
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
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

function toolId(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value)
  );
}

function semanticVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)
  );
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function optionalSha256(value: unknown): boolean {
  return value === undefined || sha256(value);
}

function projectionStatus(
  value: unknown,
): value is ToolUiProjectionV2["status"] {
  return ["started", "completed", "failed", "blocked"].includes(String(value));
}

function sideEffect(value: unknown): value is ToolSideEffect {
  return ["none", "reversible", "irreversible", "unknown"].includes(
    String(value),
  );
}

function concurrency(value: unknown): value is ToolConcurrency {
  return ["safe", "serialized", "exclusive"].includes(String(value));
}

function progressOperation(value: unknown): value is ToolProgressOperation {
  return [
    "acquire",
    "reuse",
    "observe",
    "mutate",
    "verify",
    "coordinate",
    "neutral",
  ].includes(String(value));
}

function progressScope(value: unknown): value is ToolProgressScope {
  return [
    "external",
    "run_source",
    "workspace",
    "session",
    "remote",
    "control",
    "neutral",
  ].includes(String(value));
}

function progressContribution(
  value: unknown,
): value is ToolProgressContribution {
  return [
    "supporting",
    "product",
    "verification",
    "control",
    "neutral",
  ].includes(String(value));
}

function optionalModeId(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/u.test(value))
  );
}

function optionalFailureBindings(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every(
      (key) =>
        (FAILURE_BINDING_KEYS as readonly string[]).includes(key) &&
        sha256(value[key]),
    )
  );
}
