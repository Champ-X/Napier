import type { AgentProfile, ModelRef } from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime/agent";

export function recommendedCliRunModel(
  services: LocalAgentRuntimeServices,
  agent: Pick<AgentProfile, "id" | "model">,
): Promise<ModelRef> {
  return services.models.recommendDefaultRunModel(
    agent,
    services.store.listCredentialReferences(),
    services.store.listAgentRevisions(agent.id),
  );
}

export function contextualCliRunModel(
  services: LocalAgentRuntimeServices,
  agent: Pick<AgentProfile, "id" | "model">,
  automatic: boolean,
  current: ModelRef | undefined,
): Promise<ModelRef | undefined> {
  return automatic
    ? recommendedCliRunModel(services, agent)
    : Promise.resolve(current);
}
