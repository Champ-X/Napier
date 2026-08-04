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
  confirmationAvailable = false,
): AgentCapabilityStatus {
  const status = agentCapabilityStatus(
    presetId
      ? { ...profile, ...agentCapabilityPresetUpdate(presetId) }
      : profile,
  );
  return {
    ...status,
    browserInteractWithConfirmation:
      confirmationAvailable && status.browserInteractWithConfirmation,
  };
}
