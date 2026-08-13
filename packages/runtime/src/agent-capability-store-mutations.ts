import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import type {
  CapabilityContractBindingV1,
  RestoreRecommendedCapabilitiesRequestV1,
  UpgradeRecommendedCapabilitiesRequestV1,
} from "@napier/contracts/agent-capability-contract";

import { lookupCapabilityBinding } from "./agent-capability-bindings.js";
import {
  createCapabilityUpgradeModel,
  createContractUpgradeCapabilityBinding,
} from "./agent-capability-upgrade.js";
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

export type CapabilityCommitOperation = "restore" | "upgrade";

export interface CapabilityCommitStateInput {
  state: CapabilityMutableState;
  agentId: string;
  request:
    | RestoreRecommendedCapabilitiesRequestV1
    | UpgradeRecommendedCapabilitiesRequestV1;
  operation: CapabilityCommitOperation;
  persist(): Promise<void>;
  isConflict(error: unknown): boolean;
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

export class CapabilityUpgradeConflictError extends Error {
  constructor() {
    super("Capability upgrade conflict; refresh the preview and retry");
    this.name = "CapabilityUpgradeConflictError";
  }
}

export class CapabilityUpgradeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityUpgradeValidationError";
  }
}

export class CapabilityUpgradePersistenceError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      "Capability upgrade persistence failed; no upgrade was committed. Refresh and retry.",
      options,
    );
    this.name = "CapabilityUpgradePersistenceError";
  }
}

export async function commitRecommendedCapabilitiesState(
  input: CapabilityCommitStateInput,
): Promise<CapabilityRestoreCommit> {
  const result =
    input.operation === "upgrade"
      ? upgradeRecommendedCapabilitiesState(
          input.state,
          input.agentId,
          input.request,
        )
      : restoreRecommendedCapabilitiesState(
          input.state,
          input.agentId,
          input.request,
        );
  try {
    await input.persist();
  } catch (error) {
    if (input.isConflict(error)) {
      throw input.operation === "upgrade"
        ? new CapabilityUpgradeConflictError()
        : new CapabilityRestoreConflictError();
    }
    throw input.operation === "upgrade"
      ? new CapabilityUpgradePersistenceError({ cause: error })
      : new CapabilityRestorePersistenceError({ cause: error });
  }
  return structuredClone({
    previousRevision: result.previous.revision,
    agent: result.updated,
    binding: result.binding,
  });
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

export function upgradeRecommendedCapabilitiesState(
  state: CapabilityMutableState,
  agentId: string,
  request: UpgradeRecommendedCapabilitiesRequestV1,
): CapabilityRestoreStateResult {
  const index = state.agents.findIndex((agent) => agent.id === agentId);
  const current = state.agents[index];
  if (!current) throw new Error(`Agent not found: ${agentId}`);
  const lookup = lookupCapabilityBinding(
    state.agentCapabilityBindings,
    current.id,
    current.revision,
    { retainedRevisions: state.agentRevisions },
  );
  if (lookup.status !== "valid") {
    throw new CapabilityUpgradeValidationError(
      lookup.status === "broken"
        ? "Capability binding is broken; use explicit restore after review"
        : "Capability profile is unmanaged; use explicit restore after review",
    );
  }
  const model = createCapabilityUpgradeModel(current, lookup.binding);
  if (!model) {
    throw new CapabilityUpgradeValidationError(
      "Capability profile has no safe contract upgrade",
    );
  }
  if (
    request.schemaVersion !== 1 ||
    !Number.isInteger(request.expectedRevision) ||
    request.expectedRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(request.diffSha256)
  ) {
    throw new CapabilityUpgradeValidationError(
      "Capability upgrade request is invalid",
    );
  }
  if (
    request.expectedRevision !== current.revision ||
    request.diffSha256 !== model.preview.diffSha256
  ) {
    throw new CapabilityUpgradeConflictError();
  }
  let updated = updateAgentProfile(current, model.update);
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
      source: "migrated",
      changedFields,
    }),
  );
  state.agentCapabilityBindings = repairCapabilityBindingRecords(
    state.agentCapabilityBindings,
    agentId,
    state.agentRevisions,
  );
  const binding = createContractUpgradeCapabilityBinding(
    updated,
    lookup.binding,
  );
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
