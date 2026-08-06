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
