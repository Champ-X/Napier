import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import type {
  CapabilityContractBindingV1,
  RestoreRecommendedCapabilitiesRequestV1,
} from "@napier/contracts/agent-capability-contract";

import {
  changedAgentFields,
  createAgentProfileRevision,
  updateAgentProfile,
} from "./agents.js";
import { createExplicitRestoreCapabilityBinding } from "./agent-capability-bindings.js";
import {
  createCapabilityRestorePreview,
  recommendedCapabilityUpdate,
} from "./default-agent-capability-contract.js";
import { nowIso } from "./ids.js";

export interface CapabilityMutableState {
  agents: AgentProfile[];
  agentRevisions: AgentProfileRevision[];
  agentCapabilityBindings: unknown[];
}

export interface CapabilityRestoreStateResult {
  previous: AgentProfile;
  updated: AgentProfile;
  binding: CapabilityContractBindingV1;
}

export interface CapabilityRestoreCommit {
  previousRevision: number;
  agent: AgentProfile;
  binding: CapabilityContractBindingV1;
}

export class CapabilityRestoreConflictError extends Error {
  constructor() {
    super("Capability restore conflict; refresh the preview and retry");
    this.name = "CapabilityRestoreConflictError";
  }
}

export class CapabilityRestoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRestoreValidationError";
  }
}

export class CapabilityRestorePersistenceError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "Capability restore persistence failed; no restore was committed. Refresh and retry.",
      options,
    );
    this.name = "CapabilityRestorePersistenceError";
  }
}

export function restoreRecommendedCapabilitiesState(
  state: CapabilityMutableState,
  agentId: string,
  request: RestoreRecommendedCapabilitiesRequestV1,
): CapabilityRestoreStateResult {
  const index = state.agents.findIndex((agent) => agent.id === agentId);
  const current = state.agents[index];
  if (!current) throw new Error(`Agent not found: ${agentId}`);
  const preview = createCapabilityRestorePreview(current);
  if (
    request.schemaVersion !== 1 ||
    !Number.isInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(request.diffSha256)
  ) {
    throw new CapabilityRestoreValidationError(
      "Capability restore request is invalid",
    );
  }
  if (
    request.expectedRevision !== current.revision ||
    request.diffSha256 !== preview.diffSha256
  ) {
    throw new CapabilityRestoreConflictError();
  }
  let updated = updateAgentProfile(current, recommendedCapabilityUpdate());
  const changedFields = changedAgentFields(current, updated);
  if (updated.revision === current.revision) {
    updated = {
      ...updated,
      revision: current.revision + 1,
      updatedAt: nowIso(),
    };
  }
  state.agents[index] = updated;
  state.agentRevisions.push(
    createAgentProfileRevision(updated, {
      source: changedFields.length > 0 ? "updated" : "migrated",
      changedFields,
    }),
  );
  state.agentCapabilityBindings = repairCapabilityBindingRecords(
    state.agentCapabilityBindings,
    agentId,
    state.agentRevisions,
  );
  const binding = createExplicitRestoreCapabilityBinding(updated);
  state.agentCapabilityBindings.push(binding);
  return structuredClone({ previous: current, updated, binding });
}

function repairCapabilityBindingRecords(
  records: readonly unknown[],
  agentId: string,
  revisions: readonly AgentProfileRevision[],
): unknown[] {
  const retained = new Set(
    revisions
      .filter((revision) => revision.agentId === agentId)
      .map((revision) => revision.revision),
  );
  return records.filter((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return false;
    }
    const candidate = record as Record<string, unknown>;
    if (
      typeof candidate.agentId !== "string" ||
      !Number.isInteger(candidate.agentRevision)
    ) {
      return false;
    }
    return (
      candidate.agentId !== agentId ||
      retained.has(Number(candidate.agentRevision))
    );
  });
}
