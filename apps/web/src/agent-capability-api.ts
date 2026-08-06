import type {
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesRequestV1,
  RestoreRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";

import { requestJson } from "./api-client";

export function getAgentCapabilities(
  agentId: string,
): Promise<EffectiveAgentCapabilityProjectionV1> {
  return requestJson(`/api/agents/${encodeURIComponent(agentId)}/capabilities`);
}

export function restoreRecommendedAgentCapabilities(
  agentId: string,
  request: RestoreRecommendedCapabilitiesRequestV1,
): Promise<RestoreRecommendedCapabilitiesResultV1> {
  return requestJson(
    `/api/agents/${encodeURIComponent(agentId)}/capabilities/restore`,
    { method: "POST", body: JSON.stringify(request) },
  );
}
