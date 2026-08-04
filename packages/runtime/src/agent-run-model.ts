import type {
  AgentProfile,
  ModelRef,
  RunInvocationSource,
} from "@napier/contracts";

import type { ModelRegistry } from "./models.js";
import type { LocalStore } from "./store.js";

export function resolveAgentRunModel(
  store: Pick<LocalStore, "listAgentRevisions" | "listCredentialReferences">,
  models: Pick<ModelRegistry, "recommendDefaultRunModel">,
  agent: AgentProfile,
  source: RunInvocationSource,
  explicit?: ModelRef,
): Promise<ModelRef> | ModelRef {
  if (explicit) return explicit;
  if (source !== "user") return agent.model;
  return models.recommendDefaultRunModel(
    agent,
    store.listCredentialReferences(),
    store.listAgentRevisions(agent.id),
  );
}
