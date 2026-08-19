import { describe, expect, it } from "vitest";

import type { AgentProfile, PromptVariableDefinition } from "@napier/contracts";

import {
  canSaveContextAgentProfile,
  contextAgentProfileDraft,
} from "../src/context-agent-profile-draft";

describe("context Agent profile draft", () => {
  it("projects persisted profile limits without sharing prompt-variable state", () => {
    const agent = profile();
    const draft = contextAgentProfileDraft(agent);

    expect(draft.agentRecoveryMode).toBe("safe_read_only");
    expect(draft.agentRecoveryBackoffSeconds).toBe(7);
    expect(draft.agentRunMaxTurns).toBe(42);
    expect(draft.agentAdvisorReviewModelKey).toBe("anthropic/reviewer");
    expect(draft.agentPromptVariables).toEqual(agent.promptVariables);
    expect(draft.agentPromptVariables).not.toBe(agent.promptVariables);
  });

  it("admits only complete drafts with a valid loop-guard contract", () => {
    const base = {
      busy: false,
      name: "Napier",
      description: "Desktop agent",
      systemPrompt: "Complete the task.",
      modelConfigured: true,
      advisorReviewModelAvailable: true,
      promptVariables: [
        { name: "today", type: "current_date", format: "iso-date" },
      ] as PromptVariableDefinition[],
      toolLoopGuardThreshold: 3,
      toolLoopGuardExemptTools: "web_search",
    };

    expect(canSaveContextAgentProfile(base)).toBe(true);
    expect(
      canSaveContextAgentProfile({
        ...base,
        toolLoopGuardExemptTools: "web_search, web_search",
      }),
    ).toBe(false);
    expect(
      canSaveContextAgentProfile({ ...base, modelConfigured: false }),
    ).toBe(false);
  });
});

function profile(): AgentProfile {
  return {
    id: "agent_default",
    revision: 4,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    name: "Napier",
    description: "Desktop agent",
    systemPrompt: "Complete the task.",
    model: { provider: "openai", id: "primary" },
    thinkingLevel: "medium",
    toolPolicy: "workspace",
    enabledTools: ["read_file", "web_search"],
    enabledSkills: ["coding"],
    enabledSubagents: ["reviewer"],
    promptVariables: [
      { name: "today", type: "current_date", format: "iso-date" },
    ],
    automaticRecovery: {
      mode: "safe_read_only",
      maxAttempts: 2,
      backoffMs: 7_000,
    },
    modelAdvisor: {
      mode: "observe",
      enabledRules: ["unverified_verification_claim"],
      maxCorrectionAttempts: 1,
      reviewModel: { provider: "anthropic", id: "reviewer" },
    },
    toolLoopGuard: { enabled: true, threshold: 3, exemptTools: ["web_search"] },
    runLimits: {
      maxTurns: 42,
      maxTotalTokens: 20_000,
      maxCostUsd: 2,
      timeoutMs: 120_000,
    },
    subagentLimits: {
      maxConcurrent: 2,
      maxTotal: 4,
      maxTurns: 8,
      timeoutMs: 90_000,
    },
  };
}
