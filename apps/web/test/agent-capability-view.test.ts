import type { AgentProfile } from "@napier/contracts";
import { agentCapabilityPresetUpdate } from "@napier/contracts/agent-capabilities";
import { describe, expect, it } from "vitest";

import {
  agentCapabilityBadgeText,
  agentCapabilityDetailText,
} from "../src/agent-capability-view-model";

describe("Agent capability Web surfaces", () => {
  it("renders an honest Browser status and preset selector", () => {
    const agent = profile("browser");
    expect(agentCapabilityBadgeText(agent)).toBe(
      "Browser · Read only · interact no",
    );
    expect(agentCapabilityDetailText(agent)).toBe(
      "Read only · 4 tools · Browser read yes · Browser interact no",
    );
    expect(agentCapabilityBadgeText(agent)).not.toContain("interact yes");
  });

  it("renders Safe Automation interaction as confirmation-bound", () => {
    const agent = profile("safe_automation");
    expect(agentCapabilityBadgeText(agent)).toBe(
      "Safe Automation · Workspace changes · interact confirm",
    );
    expect(agentCapabilityDetailText(agent)).toContain(
      "Browser interact confirm",
    );
    expect(agentCapabilityBadgeText(agent)).not.toContain("interact yes");
  });
});

function profile(
  preset: Parameters<typeof agentCapabilityPresetUpdate>[0],
): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "fixture",
    systemPrompt: "fixture system prompt",
    model: { provider: "napier", id: "demo" },
    thinkingLevel: "medium",
    ...agentCapabilityPresetUpdate(preset),
    revision: 1,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}
