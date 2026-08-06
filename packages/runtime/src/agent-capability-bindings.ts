import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import {
  CAPABILITY_MANAGED_FIELDS,
  type CapabilityContractBindingV1,
  type CapabilityManagedField,
} from "@napier/contracts/agent-capability-contract";

import {
  type AgentCapabilityContractRecommendation,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
  HISTORICAL_DEFAULT_CAPABILITY_SIGNATURES,
  historicalDefaultCapabilitySignature,
  managedCapabilityPayload,
} from "./default-agent-capability-contract.js";

const BINDING_SOURCES = new Set([
  "seeded",
  "legacy_detected",
  "explicit_restore",
  "updated",
  "rollback",
]);
const OWNERSHIP_VALUES = new Set([
  "recommended",
  "explicit_overrides",
  "unknown_legacy",
]);

export type CapabilityBindingLookup =
  | { status: "missing" }
  | { status: "valid"; binding: CapabilityContractBindingV1 }
  | { status: "broken"; detail: string };

export function validCapabilityBinding(
  lookup: CapabilityBindingLookup,
): CapabilityContractBindingV1 | undefined {
  return lookup.status === "valid" ? lookup.binding : undefined;
}

export function createSeededCapabilityBinding(
  profile: AgentProfile,
): CapabilityContractBindingV1 {
  return createBinding(profile, {
    source: "seeded",
    ownership: "recommended",
    explicitOverrideFields: [],
  });
}

export function createLegacyDetectedCapabilityBinding(
  profile: AgentProfile,
): CapabilityContractBindingV1 | undefined {
  if (profile.id !== "agent_napier") return undefined;
  const legacySignatureSha256 = historicalDefaultCapabilitySignature(profile);
  if (!legacySignatureSha256) return undefined;
  return createBinding(profile, {
    source: "legacy_detected",
    ownership: "unknown_legacy",
    explicitOverrideFields: [...CAPABILITY_MANAGED_FIELDS],
    legacySignatureSha256,
  });
}

export function createExplicitRestoreCapabilityBinding(
  profile: AgentProfile,
): CapabilityContractBindingV1 {
  return createBinding(profile, {
    source: "explicit_restore",
    ownership: "recommended",
    explicitOverrideFields: [],
  });
}

export function propagateUpdatedCapabilityBinding(
  current: CapabilityContractBindingV1 | undefined,
  before: AgentProfile,
  after: AgentProfile,
  history: readonly AgentCapabilityContractRecommendation[] = DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
): CapabilityContractBindingV1 | undefined {
  if (!current) return undefined;
  if (!capabilityContractRecommendation(current, history)) return undefined;
  const changed = changedManagedFields(before, after);
  const explicitOverrideFields = canonicalManagedFields([
    ...new Set([...current.explicitOverrideFields, ...changed]),
  ]);
  const ownership =
    current.ownership === "unknown_legacy" && changed.length === 0
      ? "unknown_legacy"
      : explicitOverrideFields.length > 0
        ? "explicit_overrides"
        : current.ownership;
  const { legacySignatureSha256, ...base } = current;
  return {
    ...base,
    agentRevision: after.revision,
    source: "updated",
    ownership,
    explicitOverrideFields,
    ...(ownership === "unknown_legacy" && legacySignatureSha256
      ? { legacySignatureSha256 }
      : {}),
    appliedAt: after.updatedAt,
  };
}

export function createRollbackCapabilityBinding(
  target: CapabilityContractBindingV1 | undefined,
  rolledBackProfile: AgentProfile,
): CapabilityContractBindingV1 | undefined {
  if (!target) return undefined;
  return {
    ...target,
    agentRevision: rolledBackProfile.revision,
    source: "rollback",
    appliedAt: rolledBackProfile.updatedAt,
  };
}

export function lookupCapabilityBinding(
  records: unknown,
  agentId: string,
  agentRevision: number,
  options: {
    history?: readonly AgentCapabilityContractRecommendation[];
    retainedRevisions?: readonly AgentProfileRevision[];
  } = {},
): CapabilityBindingLookup {
  if (!Array.isArray(records)) {
    return {
      status: "broken",
      detail: "Capability binding records must be an array",
    };
  }
  if (records.some((record) => bindingRecordKey(record) === undefined)) {
    return {
      status: "broken",
      detail: "Malformed capability binding record is retained",
    };
  }
  const retainedKeys = options.retainedRevisions
    ? new Set(
        options.retainedRevisions.map(
          (revision) => `${revision.agentId}:${revision.revision}`,
        ),
      )
    : undefined;
  if (
    retainedKeys &&
    records.some((record) => {
      const identity = bindingRecordIdentity(record);
      return (
        identity?.agentId === agentId &&
        identity.agentRevision !== agentRevision &&
        !retainedKeys.has(`${identity.agentId}:${identity.agentRevision}`)
      );
    })
  ) {
    return {
      status: "broken",
      detail: "Orphan capability binding record is retained for this Agent",
    };
  }
  const matching = records.filter(
    (record) => bindingRecordKey(record) === `${agentId}:${agentRevision}`,
  );
  if (matching.length === 0) return { status: "missing" };
  if (matching.length > 1) {
    return { status: "broken", detail: "Duplicate capability binding records" };
  }
  try {
    return {
      status: "valid",
      binding: validateCapabilityBinding(
        matching[0],
        options.history ?? DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
      ),
    };
  } catch (error) {
    return {
      status: "broken",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeCapabilityBindingRecords(
  records: unknown,
  agents: readonly AgentProfile[],
  revisions: readonly AgentProfileRevision[],
): unknown[] {
  const normalized = Array.isArray(records)
    ? [...records]
    : records === undefined
      ? []
      : agents.length > 0
        ? agents.map((agent) => ({
            agentId: agent.id,
            agentRevision: agent.revision,
            corruption: "agentCapabilityBindings must be an array",
            retainedValue: records,
          }))
        : [
            {
              corruption: "agentCapabilityBindings must be an array",
              retainedValue: records,
            },
          ];
  const retained = new Set(
    revisions.map((revision) => `${revision.agentId}:${revision.revision}`),
  );
  const current = new Set(
    agents.map((agent) => `${agent.id}:${agent.revision}`),
  );
  const liveAgents = new Map(agents.map((agent) => [agent.id, agent]));
  const minimumRetainedRevision = new Map<string, number>();
  for (const revision of revisions) {
    const currentMinimum = minimumRetainedRevision.get(revision.agentId);
    if (currentMinimum === undefined || revision.revision < currentMinimum) {
      minimumRetainedRevision.set(revision.agentId, revision.revision);
    }
  }
  return normalized.filter((record) => {
    const identity = bindingRecordIdentity(record);
    if (!identity) return true;
    const agent = liveAgents.get(identity.agentId);
    if (!agent) return false;
    const key = `${identity.agentId}:${identity.agentRevision}`;
    if (retained.has(key) || current.has(key)) return true;
    const minimum = minimumRetainedRevision.get(identity.agentId);
    return minimum === undefined || identity.agentRevision >= minimum;
  });
}

export function ensureCurrentCapabilityBindings(
  records: unknown,
  agents: readonly AgentProfile[],
  revisions: readonly AgentProfileRevision[],
): unknown[] {
  const normalized = normalizeCapabilityBindingRecords(
    records,
    agents,
    revisions,
  );
  for (const agent of agents) {
    const lookup = lookupCapabilityBinding(
      normalized,
      agent.id,
      agent.revision,
      { retainedRevisions: revisions },
    );
    if (lookup.status !== "missing") continue;
    const detected = createLegacyDetectedCapabilityBinding(agent);
    if (detected) normalized.push(detected);
  }
  return normalized;
}

export function bindingMatchesProfile(
  binding: CapabilityContractBindingV1,
  profile: AgentProfile,
  history: readonly AgentCapabilityContractRecommendation[] = DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
): boolean {
  if (
    binding.agentId !== profile.id ||
    binding.agentRevision !== profile.revision
  ) {
    return false;
  }
  if (binding.ownership === "unknown_legacy") {
    return Boolean(
      binding.legacySignatureSha256 &&
      binding.legacySignatureSha256 ===
        historicalDefaultCapabilitySignature(profile),
    );
  }
  const contract = capabilityContractRecommendation(binding, history);
  if (!contract) return false;
  const actual = managedCapabilityPayload(profile);
  const recommended = contract.recommendation;
  const overrides = new Set(binding.explicitOverrideFields);
  return CAPABILITY_MANAGED_FIELDS.every((field) => {
    if (overrides.has(field)) return true;
    return JSON.stringify(actual[field]) === JSON.stringify(recommended[field]);
  });
}

function createBinding(
  profile: AgentProfile,
  input: Pick<
    CapabilityContractBindingV1,
    "source" | "ownership" | "explicitOverrideFields" | "legacySignatureSha256"
  >,
): CapabilityContractBindingV1 {
  return {
    schemaVersion: 1,
    agentId: profile.id,
    agentRevision: profile.revision,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
    recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
    source: input.source,
    ownership: input.ownership,
    explicitOverrideFields: canonicalManagedFields(
      input.explicitOverrideFields,
    ),
    ...(input.legacySignatureSha256
      ? { legacySignatureSha256: input.legacySignatureSha256 }
      : {}),
    appliedAt: profile.updatedAt,
  };
}

export function validateCapabilityBinding(
  input: unknown,
  history: readonly AgentCapabilityContractRecommendation[] = DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
): CapabilityContractBindingV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Capability binding must be an object");
  }
  const binding = input as CapabilityContractBindingV1;
  if (
    binding.schemaVersion !== 1 ||
    binding.contractId !== DEFAULT_AGENT_CAPABILITY_CONTRACT_ID ||
    !capabilityContractRecommendation(binding, history) ||
    !/^[a-z][a-z0-9_-]{2,80}$/.test(binding.agentId) ||
    !Number.isInteger(binding.agentRevision) ||
    binding.agentRevision < 1 ||
    !BINDING_SOURCES.has(binding.source) ||
    !OWNERSHIP_VALUES.has(binding.ownership) ||
    !Number.isFinite(Date.parse(binding.appliedAt))
  ) {
    throw new Error("Capability binding contract metadata is invalid");
  }
  const fields = canonicalManagedFields(binding.explicitOverrideFields);
  if (
    JSON.stringify(fields) !== JSON.stringify(binding.explicitOverrideFields)
  ) {
    throw new Error("Capability override fields are not canonical");
  }
  if (
    !sourceSupportsOwnership(binding.source, binding.ownership) ||
    (binding.ownership === "recommended" && fields.length !== 0) ||
    (binding.ownership === "explicit_overrides" && fields.length === 0)
  ) {
    throw new Error("Capability binding ownership metadata is invalid");
  }
  if (binding.ownership === "unknown_legacy") {
    if (
      !binding.legacySignatureSha256 ||
      !/^[a-f0-9]{64}$/.test(binding.legacySignatureSha256) ||
      fields.length !== CAPABILITY_MANAGED_FIELDS.length ||
      !Object.values(HISTORICAL_DEFAULT_CAPABILITY_SIGNATURES).some(
        (signature: string) => signature === binding.legacySignatureSha256,
      )
    ) {
      throw new Error("Legacy capability ownership metadata is invalid");
    }
  } else if (binding.legacySignatureSha256 !== undefined) {
    throw new Error("Capability binding has unexpected legacy metadata");
  }
  return structuredClone(binding);
}

function capabilityContractRecommendation(
  binding: Pick<
    CapabilityContractBindingV1,
    "contractId" | "contractVersion" | "recommendationSha256"
  >,
  history: readonly AgentCapabilityContractRecommendation[],
): AgentCapabilityContractRecommendation | undefined {
  return history.find(
    (candidate) =>
      candidate.contractId === binding.contractId &&
      candidate.contractVersion === binding.contractVersion &&
      candidate.recommendationSha256 === binding.recommendationSha256,
  );
}

function sourceSupportsOwnership(
  source: CapabilityContractBindingV1["source"],
  ownership: CapabilityContractBindingV1["ownership"],
): boolean {
  if (source === "seeded" || source === "explicit_restore") {
    return ownership === "recommended";
  }
  if (source === "legacy_detected") return ownership === "unknown_legacy";
  return true;
}

function changedManagedFields(
  before: AgentProfile,
  after: AgentProfile,
): CapabilityManagedField[] {
  const left = managedCapabilityPayload(before);
  const right = managedCapabilityPayload(after);
  return CAPABILITY_MANAGED_FIELDS.filter(
    (field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]),
  );
}

function canonicalManagedFields(
  input: readonly CapabilityManagedField[],
): CapabilityManagedField[] {
  if (!Array.isArray(input)) {
    throw new Error("Capability override fields must be an array");
  }
  const requested = new Set(input);
  if (
    requested.size !== input.length ||
    input.some((field) => !CAPABILITY_MANAGED_FIELDS.includes(field))
  ) {
    throw new Error("Capability override fields are invalid");
  }
  return CAPABILITY_MANAGED_FIELDS.filter((field) => requested.has(field));
}

function bindingRecordKey(input: unknown): string | undefined {
  const identity = bindingRecordIdentity(input);
  return identity
    ? `${identity.agentId}:${String(identity.agentRevision)}`
    : undefined;
}

function bindingRecordIdentity(
  input: unknown,
): { agentId: string; agentRevision: number } | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const record = input as Record<string, unknown>;
  return typeof record.agentId === "string" &&
    Number.isInteger(record.agentRevision)
    ? {
        agentId: record.agentId,
        agentRevision: Number(record.agentRevision),
      }
    : undefined;
}
