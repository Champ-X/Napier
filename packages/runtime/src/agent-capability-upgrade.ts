import type { AgentProfile, UpdateAgentProfileRequest } from "@napier/contracts";
import type {
  CapabilityContractBindingV1,
  CapabilityUpgradePreviewV1,
} from "@napier/contracts/agent-capability-contract";

import {
  bindingMatchesProfile,
} from "./agent-capability-bindings.js";
import {
  capabilityDiffOperations,
  capabilitySha256,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
  managedCapabilityPayload,
  type AgentCapabilityContractRecommendation,
} from "./default-agent-capability-contract.js";

export interface CapabilityUpgradeModel {
  preview: CapabilityUpgradePreviewV1;
  update: Pick<
    AgentProfile,
    "toolPolicy" | "enabledTools" | "enabledSkills" | "enabledSubagents"
  > &
    UpdateAgentProfileRequest;
}

export function createCapabilityUpgradeModel(
  profile: AgentProfile,
  binding: CapabilityContractBindingV1,
  history: readonly AgentCapabilityContractRecommendation[] = DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
): CapabilityUpgradeModel | undefined {
  const source = history.find(
    (candidate) =>
      candidate.contractId === binding.contractId &&
      candidate.contractVersion === binding.contractVersion &&
      candidate.recommendationSha256 === binding.recommendationSha256,
  );
  if (
    !source ||
    !bindingMatchesProfile(binding, profile, history) ||
    binding.contractId !== DEFAULT_AGENT_CAPABILITY_CONTRACT_ID ||
    binding.contractVersion >= DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION ||
    binding.ownership === "unknown_legacy"
  ) {
    return undefined;
  }
  const current = managedCapabilityPayload(profile);
  const overrides = new Set(binding.explicitOverrideFields);
  const target = {
    toolPolicy: overrides.has("toolPolicy")
      ? current.toolPolicy
      : DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.toolPolicy,
    enabledTools: overrides.has("enabledTools")
      ? current.enabledTools
      : DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledTools,
    enabledSkills: overrides.has("enabledSkills")
      ? current.enabledSkills
      : DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
    enabledSubagents: overrides.has("enabledSubagents")
      ? current.enabledSubagents
      : DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSubagents,
  };
  const content = {
    schemaVersion: 1 as const,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    sourceContractVersion: source.contractVersion,
    targetContractVersion: DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
    sourceRecommendationSha256: source.recommendationSha256,
    targetRecommendationSha256:
      DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
    agentId: profile.id,
    agentRevision: profile.revision,
    explicitOverrideFields: [...binding.explicitOverrideFields],
    currentManagedStateSha256: capabilitySha256(current),
    targetManagedStateSha256: capabilitySha256(target),
    operations: capabilityDiffOperations(current, target),
  };
  return {
    preview: {
      ...content,
      diffSha256: capabilitySha256(content),
    },
    update: {
      toolPolicy: target.toolPolicy,
      enabledTools: [...target.enabledTools],
      enabledSkills: [...target.enabledSkills],
      enabledSubagents: [...target.enabledSubagents],
    },
  };
}

export function createContractUpgradeCapabilityBinding(
  profile: AgentProfile,
  previous: CapabilityContractBindingV1,
): CapabilityContractBindingV1 {
  return {
    schemaVersion: 1,
    agentId: profile.id,
    agentRevision: profile.revision,
    contractId: DEFAULT_AGENT_CAPABILITY_CONTRACT_ID,
    contractVersion: DEFAULT_AGENT_CAPABILITY_CONTRACT_VERSION,
    recommendationSha256: DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
    source: "contract_upgrade",
    ownership: previous.ownership,
    explicitOverrideFields: [...previous.explicitOverrideFields],
    appliedAt: profile.updatedAt,
  };
}
