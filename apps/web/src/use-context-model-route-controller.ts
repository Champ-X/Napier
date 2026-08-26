import { useEffect, useState } from "react";

import type {
  AgentProfile,
  CredentialReference,
  ModelSummary,
} from "@napier/contracts";
import type { ModelRoutePolicyV2 } from "@napier/contracts/model-route";

import {
  createModelRouteDraft,
  modelRouteDraftError,
} from "./model-route-editor";

export function useContextModelRouteController(
  agent: AgentProfile,
  models: readonly ModelSummary[],
  credentials: readonly CredentialReference[],
) {
  const [modelRouteEnabled, setModelRouteEnabled] = useState(
    agent.modelRoute !== undefined,
  );
  const [modelRoutePolicy, setModelRoutePolicy] = useState<ModelRoutePolicyV2>(
    () => createModelRouteDraft(agent),
  );

  useEffect(() => {
    setModelRouteEnabled(agent.modelRoute !== undefined);
    setModelRoutePolicy(createModelRouteDraft(agent));
  }, [agent.id, agent.revision]);

  return {
    modelRouteEnabled,
    setModelRouteEnabled,
    modelRoutePolicy,
    setModelRoutePolicy,
    modelRouteError: modelRouteEnabled
      ? modelRouteDraftError(modelRoutePolicy, models, credentials)
      : undefined,
  };
}
