import type {
  EffectiveAgentCapabilityProjectionV1,
  RestoreRecommendedCapabilitiesRequestV1,
  RestoreRecommendedCapabilitiesResultV1,
} from "@napier/contracts/agent-capability-contract";
import type { AgentCapabilityPresetId } from "@napier/contracts/agent-capabilities";

import { requestJson, requestJsonWithResponse } from "./api-client";

export async function getAgentCapabilities(
  agentId: string,
  preset?: AgentCapabilityPresetId,
): Promise<EffectiveAgentCapabilityProjectionV1> {
  const path = `/api/agents/${encodeURIComponent(agentId)}/capabilities${
    preset ? `?preset=${encodeURIComponent(preset)}` : ""
  }`;
  const response =
    await requestJsonWithResponse<EffectiveAgentCapabilityProjectionV1>(path);
  const projectedPreset =
    response.headers.get("x-napier-capability-preset") ?? undefined;
  if (
    projectedPreset !== preset ||
    response.body.capabilityPreset !== preset
  ) {
    throw new Error("Capability projection preset evidence does not match");
  }
  return response.body;
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
