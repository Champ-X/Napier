import type { AgentProfile, PromptVariableDefinition } from "@napier/contracts";

import {
  DEFAULT_AGENT_MODEL_ADVISOR_POLICY,
  DEFAULT_AGENT_RUN_LIMITS,
} from "./context-agent-defaults";
import {
  parseToolLoopGuardExemptTools,
  validPromptVariables,
} from "./context-panel-helpers";

export function contextAgentProfileDraft(agent: AgentProfile) {
  return {
    agentName: agent.name,
    agentDescription: agent.description,
    agentSystemPrompt: agent.systemPrompt,
    agentPromptVariables: structuredClone(agent.promptVariables ?? []),
    agentThinkingLevel: agent.thinkingLevel,
    agentToolPolicy: agent.toolPolicy,
    agentTools: agent.enabledTools,
    agentSkills: agent.enabledSkills,
    agentSubagents: agent.enabledSubagents ?? [],
    agentRecoveryMode: agent.automaticRecovery?.mode ?? "manual",
    agentRecoveryMaxAttempts: agent.automaticRecovery?.maxAttempts ?? 2,
    agentRecoveryBackoffSeconds: Math.round(
      (agent.automaticRecovery?.backoffMs ?? 5_000) / 1_000,
    ),
    agentAdvisorMode:
      agent.modelAdvisor?.mode ?? DEFAULT_AGENT_MODEL_ADVISOR_POLICY.mode,
    agentAdvisorRules:
      agent.modelAdvisor?.enabledRules ??
      DEFAULT_AGENT_MODEL_ADVISOR_POLICY.enabledRules,
    agentAdvisorCorrectionAttempts:
      agent.modelAdvisor?.maxCorrectionAttempts ??
      DEFAULT_AGENT_MODEL_ADVISOR_POLICY.maxCorrectionAttempts,
    agentAdvisorReviewModelKey: agent.modelAdvisor?.reviewModel
      ? `${agent.modelAdvisor.reviewModel.provider}/${agent.modelAdvisor.reviewModel.id}`
      : "",
    agentToolLoopGuardEnabled: agent.toolLoopGuard?.enabled ?? true,
    agentToolLoopGuardThreshold: agent.toolLoopGuard?.threshold ?? 3,
    agentToolLoopGuardExemptTools: (
      agent.toolLoopGuard?.exemptTools ?? []
    ).join(", "),
    agentRunMaxTurns:
      agent.runLimits?.maxTurns ?? DEFAULT_AGENT_RUN_LIMITS.maxTurns,
    agentRunMaxTotalTokens:
      agent.runLimits?.maxTotalTokens ??
      DEFAULT_AGENT_RUN_LIMITS.maxTotalTokens,
    agentRunMaxCostUsd:
      agent.runLimits?.maxCostUsd ?? DEFAULT_AGENT_RUN_LIMITS.maxCostUsd,
    agentRunTimeoutSeconds: Math.round(
      (agent.runLimits?.timeoutMs ?? DEFAULT_AGENT_RUN_LIMITS.timeoutMs) /
        1_000,
    ),
    agentMaxConcurrent: agent.subagentLimits?.maxConcurrent ?? 4,
    agentMaxTotal: agent.subagentLimits?.maxTotal ?? 8,
    agentMaxTurns: agent.subagentLimits?.maxTurns ?? 16,
    agentTimeoutSeconds: Math.round(
      (agent.subagentLimits?.timeoutMs ?? 300_000) / 1_000,
    ),
  };
}

export interface ContextAgentProfileSaveState {
  busy: boolean;
  name: string;
  description: string;
  systemPrompt: string;
  modelConfigured: boolean;
  advisorReviewModelAvailable: boolean;
  promptVariables: PromptVariableDefinition[];
  toolLoopGuardThreshold: number;
  toolLoopGuardExemptTools: string;
}

export function canSaveContextAgentProfile({
  busy,
  name,
  description,
  systemPrompt,
  modelConfigured,
  advisorReviewModelAvailable,
  promptVariables,
  toolLoopGuardThreshold,
  toolLoopGuardExemptTools,
}: ContextAgentProfileSaveState): boolean {
  return (
    !busy &&
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    systemPrompt.trim().length > 0 &&
    modelConfigured &&
    advisorReviewModelAvailable &&
    validPromptVariables(promptVariables) &&
    Number.isSafeInteger(toolLoopGuardThreshold) &&
    toolLoopGuardThreshold >= 2 &&
    toolLoopGuardThreshold <= 8 &&
    parseToolLoopGuardExemptTools(toolLoopGuardExemptTools) !== undefined
  );
}
