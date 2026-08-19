import type {
  AgentProfile,
  AgentProfileField,
  ToolLoopGuardPolicy,
} from "@napier/contracts";

import { DEFAULT_AGENT_MODEL_ADVISOR_POLICY } from "./context-agent-defaults";

const PROFILE_FIELDS: AgentProfileField[] = [
  "name",
  "description",
  "systemPrompt",
  "model",
  "thinkingLevel",
  "toolPolicy",
  "enabledTools",
  "enabledSkills",
  "enabledSubagents",
  "subagentLimits",
  "runLimits",
  "automaticRecovery",
  "modelAdvisor",
  "promptVariables",
  "toolLoopGuard",
];

export function agentProfileDelta(
  current: AgentProfile,
  target: AgentProfile,
): AgentProfileField[] {
  return PROFILE_FIELDS.filter((field) => {
    if (field === "automaticRecovery") {
      return serialized(recoveryPolicy(current)) !== serialized(recoveryPolicy(target));
    }
    if (field === "modelAdvisor") {
      return serialized(comparableModelAdvisor(current)) !==
        serialized(comparableModelAdvisor(target));
    }
    if (field === "toolLoopGuard") {
      return serialized(comparableToolLoopGuard(current)) !==
        serialized(comparableToolLoopGuard(target));
    }
    return serialized(current[field]) !== serialized(target[field]);
  });
}

function recoveryPolicy(agent: AgentProfile) {
  return agent.automaticRecovery ?? {
    mode: "manual" as const,
    maxAttempts: 2,
    backoffMs: 5_000,
  };
}

function comparableModelAdvisor(agent: AgentProfile) {
  const policy = agent.modelAdvisor ?? DEFAULT_AGENT_MODEL_ADVISOR_POLICY;
  return {
    mode: policy.mode,
    enabledRules: [...policy.enabledRules].sort(),
    maxCorrectionAttempts: policy.maxCorrectionAttempts ?? 0,
    reviewModel: agent.modelAdvisor?.reviewModel,
  };
}

function comparableToolLoopGuard(agent: AgentProfile): ToolLoopGuardPolicy {
  return {
    enabled: agent.toolLoopGuard?.enabled ?? true,
    threshold: agent.toolLoopGuard?.threshold ?? 3,
    exemptTools: [...(agent.toolLoopGuard?.exemptTools ?? [])].sort(),
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value);
}
