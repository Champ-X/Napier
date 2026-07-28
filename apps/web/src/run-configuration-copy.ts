import type { RunConfigurationField } from "@napier/contracts";

export const runConfigurationFieldCopy: Record<RunConfigurationField, string> =
  {
    agentRevision: "Agent revision",
    model: "Model",
    systemPrompt: "System prompt",
    thinkingLevel: "Thinking level",
    toolPolicy: "Tool policy",
    enabledTools: "Workspace tools",
    enabledSkills: "Skills",
    enabledSubagents: "Subagents",
    subagentLimits: "Delegation limits",
    runLimits: "Run limits",
    automaticRecovery: "Recovery policy",
    modelAdvisor: "Model Advisor",
    executionMode: "Execution mode",
    skillCatalog: "Skill catalog",
    promptVariables: "Prompt variables",
    toolLoopGuard: "Tool loop guard",
  };
