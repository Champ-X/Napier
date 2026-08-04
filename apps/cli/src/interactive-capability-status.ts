import type { AgentProfile } from "@napier/contracts";
import {
  agentCapabilityPresetUpdate,
  agentCapabilityStatus,
  type AgentCapabilityPresetId,
  type AgentCapabilityStatus,
} from "@napier/contracts/agent-capabilities";

export function interactiveCapabilityStatus(
  profile: AgentProfile,
  presetId: AgentCapabilityPresetId | undefined,
): AgentCapabilityStatus {
  return agentCapabilityStatus(
    presetId
      ? { ...profile, ...agentCapabilityPresetUpdate(presetId) }
      : profile,
  );
}
