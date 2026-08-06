import type { AgentProfile, AgentProfileRevision } from "@napier/contracts";
import type { CapabilityContractBindingV1 } from "@napier/contracts/agent-capability-contract";

import {
  createRollbackCapabilityBinding,
  lookupCapabilityBinding,
  propagateUpdatedCapabilityBinding,
  validCapabilityBinding,
  type CapabilityBindingLookup,
} from "./agent-capability-bindings.js";

export interface AgentCapabilityBindingStoreState {
  agentCapabilityBindings: unknown[];
  agentRevisions: readonly AgentProfileRevision[];
}

export function storedAgentCapabilityBinding(
  state: AgentCapabilityBindingStoreState,
  agentId: string,
  revision: number,
): CapabilityBindingLookup {
  return lookupCapabilityBinding(
    state.agentCapabilityBindings,
    agentId,
    revision,
    { retainedRevisions: state.agentRevisions },
  );
}

export function updatedAgentCapabilityBinding(
  state: AgentCapabilityBindingStoreState,
  before: AgentProfile,
  after: AgentProfile,
): CapabilityContractBindingV1 | undefined {
  return propagateUpdatedCapabilityBinding(
    validCapabilityBinding(
      storedAgentCapabilityBinding(state, before.id, before.revision),
    ),
    before,
    after,
  );
}

export function rolledBackAgentCapabilityBinding(
  state: AgentCapabilityBindingStoreState,
  target: AgentProfileRevision,
  rolledBackProfile: AgentProfile,
): CapabilityContractBindingV1 | undefined {
  return createRollbackCapabilityBinding(
    validCapabilityBinding(
      storedAgentCapabilityBinding(state, target.agentId, target.revision),
    ),
    rolledBackProfile,
  );
}
