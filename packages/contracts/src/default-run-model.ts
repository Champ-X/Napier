import type {
  AgentProfile,
  AgentProfileRevision,
  BootstrapResponse,
  CredentialReference,
  ModelRef,
  ModelSummary,
} from "./index.js";

const DEMO_MODEL: ModelRef = { provider: "napier", id: "demo" };

export interface LiveReadyBootstrapResponse extends BootstrapResponse {
  recommendedRunModel: ModelRef;
}

export function recommendedDefaultRunModel(
  models: readonly ModelSummary[],
  credentials: readonly CredentialReference[],
  agent: Pick<AgentProfile, "id" | "model">,
  revisions: readonly Pick<
    AgentProfileRevision,
    "revision" | "changedFields"
  >[],
): ModelRef {
  const preferred = structuredClone(agent.model);
  if (!usesSeedDemoDefault(agent, revisions)) return preferred;

  const activeProviders = new Set(
    credentials
      .filter((credential) => credential.status === "active")
      .map((credential) => credential.providerId),
  );
  const configured = models.find(
    (model) =>
      model.provider !== "napier" &&
      model.configured &&
      activeProviders.has(model.provider),
  );
  if (configured) return modelRef(configured);
  return preferred;
}

function usesSeedDemoDefault(
  agent: Pick<AgentProfile, "id" | "model">,
  revisions: readonly Pick<
    AgentProfileRevision,
    "revision" | "changedFields"
  >[],
): boolean {
  return (
    agent.id === "agent_napier" &&
    agent.model.provider === DEMO_MODEL.provider &&
    agent.model.id === DEMO_MODEL.id &&
    !revisions.some(
      (revision) =>
        revision.revision > 1 && revision.changedFields.includes("model"),
    )
  );
}

function modelRef(model: Pick<ModelSummary, "provider" | "id">): ModelRef {
  return { provider: model.provider, id: model.id };
}
