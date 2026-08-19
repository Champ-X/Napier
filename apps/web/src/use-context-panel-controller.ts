import { useState } from "react";

import { getContextBootstrap } from "./context-api";
import type { ContextPanelProps } from "./context-panel-types";
import {
  modelProviderGroups,
  selectedModelAvailability,
} from "./model-selection-view-model";
import { useContextAgentProfileController } from "./use-context-agent-profile-controller";
import { useContextAgentRevisionController } from "./use-context-agent-revision-controller";
import { useContextCredentialController } from "./use-context-credential-controller";
import { useContextPromptPackageController } from "./use-context-prompt-package-controller";
import { useContextSkillContentController } from "./use-context-skill-content-controller";
import { useContextSkillPackageController } from "./use-context-skill-package-controller";

export function useContextPanelController(props: ContextPanelProps) {
  const {
    agent,
    models,
    onAgentUpdated,
    onBootstrapUpdated,
    onModel,
    publisherAnchors,
    selectedModelKey,
    skillPackageInstallations,
    threadId,
  } = props;
  const [error, setError] = useState<string>();
  const providers = [
    ...new Set(
      models
        .map((model) => model.provider)
        .filter((provider) => provider !== "napier"),
    ),
  ];
  const modelGroups = modelProviderGroups(models);
  const selectedModel = selectedModelAvailability(models, selectedModelKey);
  const signingAnchors = publisherAnchors.filter(
    (anchor) => anchor.status === "trusted" && anchor.signingSource,
  );
  const activeSkillPackageInstallation = skillPackageInstallations.find(
    (installation) => installation.status === "active",
  );
  const refreshWorkspace = async (): Promise<void> => {
    onBootstrapUpdated(await getContextBootstrap(threadId));
  };

  const profile = useContextAgentProfileController({
    agent,
    models,
    selectedModelKey,
    threadId,
    selectedModelConfigured: selectedModel.configured,
    onAgentUpdated,
    onError: setError,
  });
  const revisions = useContextAgentRevisionController({
    agent,
    threadId,
    busy: profile.configurationBusy,
    onBusy: profile.setConfigurationBusy,
    onError: setError,
    onModel,
    onAgentUpdated,
  });
  const credential = useContextCredentialController({
    providers,
    threadId,
    busy: profile.configurationBusy,
    onBusy: profile.setConfigurationBusy,
    onError: setError,
    onRefresh: refreshWorkspace,
  });
  const skillPackage = useContextSkillPackageController({
    anchors: signingAnchors,
    ...(activeSkillPackageInstallation
      ? { activeInstallation: activeSkillPackageInstallation }
      : {}),
    enabledSkills: profile.agentSkills,
    threadId,
    onError: setError,
    onRefresh: refreshWorkspace,
  });
  const skillContent = useContextSkillContentController({
    threadId,
    onError: setError,
    onRefresh: refreshWorkspace,
  });
  const promptPackage = useContextPromptPackageController({
    agent,
    anchors: signingAnchors,
    threadId,
    onError: setError,
    onRefresh: refreshWorkspace,
  });

  return {
    ...props,
    providers,
    modelGroups,
    selectedModel,
    promptSigningAnchors: signingAnchors,
    skillSigningAnchors: signingAnchors,
    activeSkillPackageInstallation,
    error,
    setError,
    refreshWorkspace,
    ...profile,
    ...revisions,
    ...credential,
    ...skillPackage,
    ...skillContent,
    ...promptPackage,
  };
}

export type ContextPanelController = ReturnType<
  typeof useContextPanelController
>;
