import type {
  AgentProfile,
  ModelRef,
  RunInvocationSource,
} from "@napier/contracts";

import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";
import type { ModelRouteRequest } from "@napier/contracts/model-route";
import { resolveModelRouteSelection } from "./model-route-resolution.js";

export function resolveAgentRunModel(
  store: Pick<LocalStore, "listAgentRevisions" | "listCredentialReferences">,
  models: Pick<ModelRegistry, "recommendDefaultRunModel">,
  agent: AgentProfile,
  source: RunInvocationSource,
  explicit?: ModelRef,
  routeRequest?: ModelRouteRequest,
): Promise<ModelRef> | ModelRef {
  if (explicit) return explicit;
  const routed = resolveModelRouteSelection({
    agentDefault: agent.model,
    ...(agent.modelRoute ? { policy: agent.modelRoute } : {}),
    ...(routeRequest ? { request: routeRequest } : {}),
    source,
  });
  if (routed.source !== "agent_default") return routed.targets[0]!.model;
  if (source !== "user") return agent.model;
  return models.recommendDefaultRunModel(
    agent,
    store.listCredentialReferences(),
    store.listAgentRevisions(agent.id),
  );
}
