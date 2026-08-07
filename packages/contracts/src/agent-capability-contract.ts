import type { ToolPolicyMode } from "./execution-core.js";

export const CAPABILITY_MANAGED_FIELDS = [
  "toolPolicy",
  "enabledTools",
  "enabledSkills",
  "enabledSubagents",
] as const;

export type CapabilityManagedField = (typeof CAPABILITY_MANAGED_FIELDS)[number];

export type CapabilityBindingSource =
  | "seeded"
  | "legacy_detected"
  | "explicit_restore"
  | "updated"
  | "rollback";

export type CapabilityOwnership =
  | "recommended"
  | "explicit_overrides"
  | "unknown_legacy";

export interface CapabilityContractBindingV1 {
  schemaVersion: 1;
  agentId: string;
  agentRevision: number;
  contractId: "napier.default-agent.capabilities";
  contractVersion: number;
  recommendationSha256: string;
  source: CapabilityBindingSource;
  ownership: CapabilityOwnership;
  explicitOverrideFields: CapabilityManagedField[];
  legacySignatureSha256?: string;
  appliedAt: string;
}

export type CapabilityDriftState =
  | "current"
  | "stale"
  | "custom_unmanaged"
  | "broken";

export type CapabilityEffect =
  | "policy"
  | "read"
  | "network_read"
  | "browser_observe"
  | "workspace_write"
  | "process"
  | "delegation"
  | "skill_catalog"
  | "unknown";

export interface CapabilityDiffOperation {
  field: CapabilityManagedField;
  operation: "add" | "remove" | "replace";
  value: string;
  effect: CapabilityEffect;
  risk: "low" | "medium" | "high" | "unknown";
}

export interface CapabilityRestorePreviewV1 {
  schemaVersion: 1;
  contractId: "napier.default-agent.capabilities";
  contractVersion: 1;
  recommendationSha256: string;
  agentId: string;
  agentRevision: number;
  currentManagedStateSha256: string;
  targetManagedStateSha256: string;
  operations: CapabilityDiffOperation[];
  diffSha256: string;
}

export interface CapabilityReadinessRecord {
  id: string;
  status:
    | "ready"
    | "available_unverified"
    | "blocked_by_policy"
    | "unavailable"
    | "catalog_only"
    | "missing"
    | "unknown_configured";
  configured: boolean;
  allowedByPolicy: boolean;
  exposed: boolean;
  detail: string;
}

export interface EffectiveAgentCapabilityProjectionV1 {
  kind: "napier.effective-agent-capabilities";
  schemaVersion: 1;
  agentId: string;
  agentRevision: number;
  contractId: "napier.default-agent.capabilities";
  contractVersion: 1;
  recommendationSha256: string;
  driftState: CapabilityDriftState;
  ownership: CapabilityOwnership | "unmanaged";
  explicitOverrideFields: CapabilityManagedField[];
  legacySignatureSha256?: string;
  toolPolicy: ToolPolicyMode;
  configuredTools: string[];
  runtimeExposedTools: string[];
  configuredSkills: string[];
  configuredSubagents: string[];
  readiness: CapabilityReadinessRecord[];
  restorePreview: CapabilityRestorePreviewV1;
  projectionSha256: string;
}

export interface RestoreRecommendedCapabilitiesRequestV1 {
  schemaVersion: 1;
  expectedRevision: number;
  diffSha256: string;
}

export interface RestoreRecommendedCapabilitiesResultV1 {
  schemaVersion: 1;
  previousRevision: number;
  projection: EffectiveAgentCapabilityProjectionV1;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CAPABILITY_DRIFT_STATES = [
  "current",
  "stale",
  "custom_unmanaged",
  "broken",
] as const;
const CAPABILITY_OWNERSHIPS = [
  "recommended",
  "explicit_overrides",
  "unknown_legacy",
  "unmanaged",
] as const;
const CAPABILITY_EFFECTS = [
  "policy",
  "read",
  "network_read",
  "browser_observe",
  "workspace_write",
  "process",
  "delegation",
  "skill_catalog",
  "unknown",
] as const;
const CAPABILITY_RISKS = ["low", "medium", "high", "unknown"] as const;
const CAPABILITY_READINESS_STATUSES = [
  "ready",
  "available_unverified",
  "blocked_by_policy",
  "unavailable",
  "catalog_only",
  "missing",
  "unknown_configured",
] as const;
const TOOL_POLICY_MODES = ["observe", "workspace", "unrestricted"] as const;

export function isEffectiveAgentCapabilityProjectionV1(
  value: unknown,
): value is EffectiveAgentCapabilityProjectionV1 {
  if (
    !exactRecord(
      value,
      [
        "kind",
        "schemaVersion",
        "agentId",
        "agentRevision",
        "contractId",
        "contractVersion",
        "recommendationSha256",
        "driftState",
        "ownership",
        "explicitOverrideFields",
        "toolPolicy",
        "configuredTools",
        "runtimeExposedTools",
        "configuredSkills",
        "configuredSubagents",
        "readiness",
        "restorePreview",
        "projectionSha256",
      ],
      ["legacySignatureSha256"],
    ) ||
    value.kind !== "napier.effective-agent-capabilities" ||
    value.schemaVersion !== 1 ||
    !nonEmptyString(value.agentId) ||
    !positiveSafeInteger(value.agentRevision) ||
    value.contractId !== "napier.default-agent.capabilities" ||
    value.contractVersion !== 1 ||
    !sha256(value.recommendationSha256) ||
    !member(value.driftState, CAPABILITY_DRIFT_STATES) ||
    !member(value.ownership, CAPABILITY_OWNERSHIPS) ||
    !memberArray(value.explicitOverrideFields, CAPABILITY_MANAGED_FIELDS) ||
    (value.legacySignatureSha256 !== undefined &&
      !sha256(value.legacySignatureSha256)) ||
    !member(value.toolPolicy, TOOL_POLICY_MODES) ||
    !stringArray(value.configuredTools) ||
    !stringArray(value.runtimeExposedTools) ||
    !stringArray(value.configuredSkills) ||
    !stringArray(value.configuredSubagents) ||
    !denseArray(value.readiness) ||
    !value.readiness.every(capabilityReadinessRecord) ||
    !capabilityRestorePreview(value.restorePreview) ||
    !sha256(value.projectionSha256)
  ) {
    return false;
  }
  return true;
}

function capabilityReadinessRecord(value: unknown): boolean {
  return (
    exactRecord(value, [
      "id",
      "status",
      "configured",
      "allowedByPolicy",
      "exposed",
      "detail",
    ]) &&
    nonEmptyString(value.id) &&
    member(value.status, CAPABILITY_READINESS_STATUSES) &&
    typeof value.configured === "boolean" &&
    typeof value.allowedByPolicy === "boolean" &&
    typeof value.exposed === "boolean" &&
    nonEmptyString(value.detail)
  );
}

function capabilityRestorePreview(value: unknown): boolean {
  return (
    exactRecord(value, [
      "schemaVersion",
      "contractId",
      "contractVersion",
      "recommendationSha256",
      "agentId",
      "agentRevision",
      "currentManagedStateSha256",
      "targetManagedStateSha256",
      "operations",
      "diffSha256",
    ]) &&
    value.schemaVersion === 1 &&
    value.contractId === "napier.default-agent.capabilities" &&
    value.contractVersion === 1 &&
    sha256(value.recommendationSha256) &&
    nonEmptyString(value.agentId) &&
    positiveSafeInteger(value.agentRevision) &&
    sha256(value.currentManagedStateSha256) &&
    sha256(value.targetManagedStateSha256) &&
    denseArray(value.operations) &&
    value.operations.every(capabilityDiffOperation) &&
    sha256(value.diffSha256)
  );
}

function capabilityDiffOperation(value: unknown): boolean {
  return (
    exactRecord(value, ["field", "operation", "value", "effect", "risk"]) &&
    member(value.field, CAPABILITY_MANAGED_FIELDS) &&
    member(value.operation, ["add", "remove", "replace"] as const) &&
    typeof value.value === "string" &&
    member(value.effect, CAPABILITY_EFFECTS) &&
    member(value.risk, CAPABILITY_RISKS)
  );
}

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
}

function member<const Value extends readonly string[]>(
  value: unknown,
  allowed: Value,
): value is Value[number] {
  return typeof value === "string" && allowed.includes(value);
}

function memberArray<const Value extends readonly string[]>(
  value: unknown,
  allowed: Value,
): value is Value[number][] {
  return denseArray(value) && value.every((item) => member(item, allowed));
}

function stringArray(value: unknown): value is string[] {
  return denseArray(value) && value.every((item) => typeof item === "string");
}

function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}
