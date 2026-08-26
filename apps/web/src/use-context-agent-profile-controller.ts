import { useEffect, useState } from "react";

import type {
  AgentProfile,
  CredentialReference,
  ModelSummary,
  PromptVariableDefinition,
  SubagentRole,
} from "@napier/contracts";
import { AGENT_TOOL_NAMES } from "@napier/contracts";

import { updateAgentProfile } from "./context-api";
import {
  canSaveContextAgentProfile,
  contextAgentProfileDraft,
} from "./context-agent-profile-draft";
import { contextCopy } from "./context-copy";
import {
  parseModelKey,
  parseToolLoopGuardExemptTools,
  toErrorMessage,
  validPromptVariableName,
} from "./context-panel-helpers";
import { reviewerModelAvailability } from "./model-selection-view-model";
import { modelRouteSavePatch } from "./model-route-editor";
import { useContextModelRouteController } from "./use-context-model-route-controller";

export interface ContextAgentProfileControllerInput {
  agent: AgentProfile;
  models: ModelSummary[];
  credentials: CredentialReference[];
  selectedModelKey: string;
  threadId: string;
  selectedModelConfigured: boolean;
  onAgentUpdated: (agent: AgentProfile) => void;
  onError: (message: string | undefined) => void;
}

export function useContextAgentProfileController({
  agent,
  models,
  credentials,
  selectedModelKey,
  threadId,
  selectedModelConfigured,
  onAgentUpdated,
  onError,
}: ContextAgentProfileControllerInput) {
  const initial = contextAgentProfileDraft(agent);
  const [agentName, setAgentName] = useState(initial.agentName);
  const [agentDescription, setAgentDescription] = useState(
    initial.agentDescription,
  );
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(
    initial.agentSystemPrompt,
  );
  const [agentPromptVariables, setAgentPromptVariables] = useState<
    PromptVariableDefinition[]
  >(initial.agentPromptVariables);
  const [agentThinkingLevel, setAgentThinkingLevel] = useState(
    initial.agentThinkingLevel,
  );
  const [agentToolPolicy, setAgentToolPolicy] = useState(
    initial.agentToolPolicy,
  );
  const [agentTools, setAgentTools] = useState(initial.agentTools);
  const [agentSkills, setAgentSkills] = useState(initial.agentSkills);
  const [agentSubagents, setAgentSubagents] = useState(initial.agentSubagents);
  const [agentRecoveryMode, setAgentRecoveryMode] = useState(
    initial.agentRecoveryMode,
  );
  const [agentRecoveryMaxAttempts, setAgentRecoveryMaxAttempts] = useState(
    initial.agentRecoveryMaxAttempts,
  );
  const [agentRecoveryBackoffSeconds, setAgentRecoveryBackoffSeconds] =
    useState(initial.agentRecoveryBackoffSeconds);
  const [agentAdvisorMode, setAgentAdvisorMode] = useState(
    initial.agentAdvisorMode,
  );
  const [agentAdvisorRules, setAgentAdvisorRules] = useState(
    initial.agentAdvisorRules,
  );
  const [agentAdvisorCorrectionAttempts, setAgentAdvisorCorrectionAttempts] =
    useState(initial.agentAdvisorCorrectionAttempts);
  const [agentAdvisorReviewModelKey, setAgentAdvisorReviewModelKey] = useState(
    initial.agentAdvisorReviewModelKey,
  );
  const [agentToolLoopGuardEnabled, setAgentToolLoopGuardEnabled] = useState(
    initial.agentToolLoopGuardEnabled,
  );
  const [agentToolLoopGuardThreshold, setAgentToolLoopGuardThreshold] =
    useState(initial.agentToolLoopGuardThreshold);
  const [agentToolLoopGuardExemptTools, setAgentToolLoopGuardExemptTools] =
    useState(initial.agentToolLoopGuardExemptTools);
  const [agentRunMaxTurns, setAgentRunMaxTurns] = useState(
    initial.agentRunMaxTurns,
  );
  const [agentRunMaxTotalTokens, setAgentRunMaxTotalTokens] = useState(
    initial.agentRunMaxTotalTokens,
  );
  const [agentRunMaxCostUsd, setAgentRunMaxCostUsd] = useState(
    initial.agentRunMaxCostUsd,
  );
  const [agentRunTimeoutSeconds, setAgentRunTimeoutSeconds] = useState(
    initial.agentRunTimeoutSeconds,
  );
  const [agentMaxConcurrent, setAgentMaxConcurrent] = useState(
    initial.agentMaxConcurrent,
  );
  const [agentMaxTotal, setAgentMaxTotal] = useState(initial.agentMaxTotal);
  const [agentMaxTurns, setAgentMaxTurns] = useState(initial.agentMaxTurns);
  const [agentTimeoutSeconds, setAgentTimeoutSeconds] = useState(
    initial.agentTimeoutSeconds,
  );
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const modelRoute = useContextModelRouteController(agent, models, credentials);

  const advisorReviewModel = reviewerModelAvailability(
    models,
    agentAdvisorReviewModelKey,
    selectedModelKey,
  );
  const shouldPersistAdvisorReviewModel =
    agentAdvisorMode !== "off" && agentAdvisorReviewModelKey.length > 0;
  const advisorReviewModelAvailable =
    !shouldPersistAdvisorReviewModel || advisorReviewModel.available;

  useEffect(() => {
    const next = contextAgentProfileDraft(agent);
    setAgentName(next.agentName);
    setAgentDescription(next.agentDescription);
    setAgentSystemPrompt(next.agentSystemPrompt);
    setAgentPromptVariables(next.agentPromptVariables);
    setAgentThinkingLevel(next.agentThinkingLevel);
    setAgentToolPolicy(next.agentToolPolicy);
    setAgentTools(next.agentTools);
    setAgentSkills(next.agentSkills);
    setAgentSubagents(next.agentSubagents);
    setAgentRecoveryMode(next.agentRecoveryMode);
    setAgentRecoveryMaxAttempts(next.agentRecoveryMaxAttempts);
    setAgentRecoveryBackoffSeconds(next.agentRecoveryBackoffSeconds);
    setAgentAdvisorMode(next.agentAdvisorMode);
    setAgentAdvisorRules(next.agentAdvisorRules);
    setAgentAdvisorCorrectionAttempts(next.agentAdvisorCorrectionAttempts);
    setAgentAdvisorReviewModelKey(next.agentAdvisorReviewModelKey);
    setAgentToolLoopGuardEnabled(next.agentToolLoopGuardEnabled);
    setAgentToolLoopGuardThreshold(next.agentToolLoopGuardThreshold);
    setAgentToolLoopGuardExemptTools(next.agentToolLoopGuardExemptTools);
    setAgentRunMaxTurns(next.agentRunMaxTurns);
    setAgentRunMaxTotalTokens(next.agentRunMaxTotalTokens);
    setAgentRunMaxCostUsd(next.agentRunMaxCostUsd);
    setAgentRunTimeoutSeconds(next.agentRunTimeoutSeconds);
    setAgentMaxConcurrent(next.agentMaxConcurrent);
    setAgentMaxTotal(next.agentMaxTotal);
    setAgentMaxTurns(next.agentMaxTurns);
    setAgentTimeoutSeconds(next.agentTimeoutSeconds);
  }, [agent.id, agent.revision]);

  useEffect(() => {
    if (agentAdvisorReviewModelKey === selectedModelKey) {
      setAgentAdvisorReviewModelKey("");
    }
  }, [agentAdvisorReviewModelKey, selectedModelKey]);

  const addPromptVariable = (): void => {
    setAgentPromptVariables((current) => {
      const names = new Set(current.map((definition) => definition.name));
      let suffix = 1;
      let name = "current_date";
      while (names.has(name)) {
        suffix += 1;
        name = `current_date_${suffix}`;
      }
      return [
        ...current,
        { name, type: "current_date", format: "readable-date" },
      ];
    });
  };
  const replacePromptVariable = (
    index: number,
    definition: PromptVariableDefinition,
  ): void => {
    setAgentPromptVariables((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? definition : candidate,
      ),
    );
  };
  const removePromptVariable = (index: number): void => {
    setAgentPromptVariables((current) =>
      current.filter((_, candidateIndex) => candidateIndex !== index),
    );
  };
  const insertPromptVariable = (name: string): void => {
    if (!validPromptVariableName(name)) return;
    const token = `{{${name}}}`;
    setAgentSystemPrompt((current) =>
      current.includes(token) ? current : `${current.trimEnd()}\n\n${token}`,
    );
  };

  const saveAgent = async (): Promise<void> => {
    if (configurationBusy) return;
    if (!selectedModelConfigured) {
      onError(contextCopy.modelUnavailableHint);
      return;
    }
    if (!advisorReviewModelAvailable) {
      onError(contextCopy.modelAdvisorReviewModelUnavailableHint);
      return;
    }
    setConfigurationBusy(true);
    onError(undefined);
    try {
      const updated = await updateAgentProfile(agent.id, {
        name: agentName,
        description: agentDescription,
        systemPrompt: agentSystemPrompt,
        model: parseModelKey(selectedModelKey),
        thinkingLevel: agentThinkingLevel,
        toolPolicy: agentToolPolicy,
        enabledTools: agentTools,
        enabledSkills: agentSkills,
        enabledSubagents: agentSubagents,
        promptVariables: agentPromptVariables,
        automaticRecovery: {
          mode: agentRecoveryMode,
          maxAttempts: agentRecoveryMaxAttempts,
          backoffMs: agentRecoveryBackoffSeconds * 1_000,
        },
        modelAdvisor: {
          mode: agentAdvisorMode,
          enabledRules: agentAdvisorRules,
          maxCorrectionAttempts: agentAdvisorCorrectionAttempts,
          ...(shouldPersistAdvisorReviewModel
            ? { reviewModel: parseModelKey(agentAdvisorReviewModelKey) }
            : {}),
        },
        toolLoopGuard: {
          enabled: agentToolLoopGuardEnabled,
          threshold: agentToolLoopGuardThreshold,
          exemptTools:
            parseToolLoopGuardExemptTools(agentToolLoopGuardExemptTools) ?? [],
        },
        ...modelRouteSavePatch(
          agent.modelRoute !== undefined,
          modelRoute.modelRouteEnabled,
          modelRoute.modelRoutePolicy,
        ),
        runLimits: {
          maxTurns: agentRunMaxTurns,
          maxTotalTokens: agentRunMaxTotalTokens,
          maxCostUsd: agentRunMaxCostUsd,
          timeoutMs: agentRunTimeoutSeconds * 1_000,
        },
        subagentLimits: {
          maxConcurrent: agentMaxConcurrent,
          maxTotal: agentMaxTotal,
          maxTurns: agentMaxTurns,
          timeoutMs: agentTimeoutSeconds * 1_000,
        },
        threadId,
      });
      onAgentUpdated(updated);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setConfigurationBusy(false);
    }
  };

  const canSaveAgent = canSaveContextAgentProfile({
    busy: configurationBusy,
    name: agentName,
    description: agentDescription,
    systemPrompt: agentSystemPrompt,
    modelConfigured: selectedModelConfigured,
    advisorReviewModelAvailable,
    promptVariables: agentPromptVariables,
    toolLoopGuardThreshold: agentToolLoopGuardThreshold,
    toolLoopGuardExemptTools: agentToolLoopGuardExemptTools,
    ...(modelRoute.modelRouteError
      ? { modelRouteError: modelRoute.modelRouteError }
      : {}),
  });
  const profileSaveDescriptionIds = [
    !selectedModelConfigured ? "context-model-unavailable" : undefined,
    !advisorReviewModelAvailable
      ? "context-advisor-review-model-unavailable"
      : undefined,
    modelRoute.modelRouteError ? "context-model-route-error" : undefined,
  ]
    .filter((id): id is string => Boolean(id))
    .join(" ");
  const subagentOptions: SubagentRole[] = [
    "researcher",
    "reviewer",
    "general",
    "coder",
  ];

  return {
    agentName,
    setAgentName,
    agentDescription,
    setAgentDescription,
    agentSystemPrompt,
    setAgentSystemPrompt,
    agentPromptVariables,
    agentThinkingLevel,
    setAgentThinkingLevel,
    agentToolPolicy,
    setAgentToolPolicy,
    agentTools,
    setAgentTools,
    agentSkills,
    setAgentSkills,
    agentSubagents,
    setAgentSubagents,
    agentRecoveryMode,
    setAgentRecoveryMode,
    agentRecoveryMaxAttempts,
    setAgentRecoveryMaxAttempts,
    agentRecoveryBackoffSeconds,
    setAgentRecoveryBackoffSeconds,
    agentAdvisorMode,
    setAgentAdvisorMode,
    agentAdvisorRules,
    setAgentAdvisorRules,
    agentAdvisorCorrectionAttempts,
    setAgentAdvisorCorrectionAttempts,
    agentAdvisorReviewModelKey,
    setAgentAdvisorReviewModelKey,
    advisorReviewModel,
    advisorReviewModelAvailable,
    agentToolLoopGuardEnabled,
    setAgentToolLoopGuardEnabled,
    agentToolLoopGuardThreshold,
    setAgentToolLoopGuardThreshold,
    agentToolLoopGuardExemptTools,
    setAgentToolLoopGuardExemptTools,
    agentRunMaxTurns,
    setAgentRunMaxTurns,
    agentRunMaxTotalTokens,
    setAgentRunMaxTotalTokens,
    agentRunMaxCostUsd,
    setAgentRunMaxCostUsd,
    agentRunTimeoutSeconds,
    setAgentRunTimeoutSeconds,
    agentMaxConcurrent,
    setAgentMaxConcurrent,
    agentMaxTotal,
    setAgentMaxTotal,
    agentMaxTurns,
    setAgentMaxTurns,
    agentTimeoutSeconds,
    setAgentTimeoutSeconds,
    configurationBusy,
    setConfigurationBusy,
    addPromptVariable,
    replacePromptVariable,
    removePromptVariable,
    insertPromptVariable,
    saveAgent,
    canSaveAgent,
    profileSaveDescriptionIds,
    subagentOptions,
    toolOptions: AGENT_TOOL_NAMES,
    ...modelRoute,
  };
}
