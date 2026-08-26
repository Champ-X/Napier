import type { AgentProfile, UpdateAgentProfileRequest } from "@napier/contracts";
import type { ModelRoutePolicyV2 } from "@napier/contracts/model-route";

import { normalizeModelRoutePolicy } from "./model-route-profile.js";

export function assertCompatibleModelRouteUpdate(
  request: Pick<UpdateAgentProfileRequest, "modelRoute" | "clearModelRoute">,
): void {
  if (request.clearModelRoute && request.modelRoute) {
    throw new Error("Agent model route update conflicts with clear request");
  }
}

export function effectiveModelRoutePolicy(
  profile: Pick<AgentProfile, "modelRoute">,
): ModelRoutePolicyV2 | undefined {
  return profile.modelRoute
    ? normalizeModelRoutePolicy(profile.modelRoute)
    : undefined;
}

export function normalizedModelRouteUpdate(
  current: ModelRoutePolicyV2 | undefined,
  requested: ModelRoutePolicyV2,
): ModelRoutePolicyV2 {
  const normalized = normalizeModelRoutePolicy(requested);
  return current &&
    JSON.stringify(normalizeModelRoutePolicy(current)) ===
      JSON.stringify(normalized)
    ? structuredClone(current)
    : normalized;
}

export function assertCanonicalAgentModelRoute(
  profile: Pick<AgentProfile, "modelRoute">,
): void {
  if (
    profile.modelRoute !== undefined &&
    JSON.stringify(profile.modelRoute) !==
      JSON.stringify(normalizeModelRoutePolicy(profile.modelRoute))
  ) {
    throw new Error("Agent profile model route is not canonical");
  }
}
