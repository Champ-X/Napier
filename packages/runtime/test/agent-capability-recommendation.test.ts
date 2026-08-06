import { describe, expect, it } from "vitest";

import {
  createAgentCapabilityContractRecommendation,
  DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
  DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256,
} from "../src/default-agent-capability-contract.js";

describe("Agent capability recommendation immutability", () => {
  it("keeps the literal V1 recommendation vector pinned", () => {
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION).toEqual(
      expect.objectContaining({
        toolPolicy: "observe",
        enabledSkills: [
          "artifact-studio",
          "data-analysis",
          "research-brief",
          "software-delivery",
        ],
        enabledSubagents: ["general", "researcher", "reviewer"],
      }),
    );
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledTools).toEqual(
      expect.arrayContaining([
        "apply_patch",
        "browser",
        "research_source",
        "web_fetch",
        "web_search",
      ]),
    );
    expect(DEFAULT_AGENT_CAPABILITY_RECOMMENDATION_SHA256).toBe(
      "17a5fb30b02770c24dff24213ade809fb1bcd452f50f9b0eb8b36a6d03c29786",
    );
  });

  it("recursively freezes the V1 payload and history against mutation", () => {
    const recommendation = DEFAULT_AGENT_CAPABILITY_RECOMMENDATION;
    const historyEntry = DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY[0]!;
    expect(Object.isFrozen(recommendation)).toBe(true);
    expect(Object.isFrozen(recommendation.enabledTools)).toBe(true);
    expect(Object.isFrozen(recommendation.enabledSkills)).toBe(true);
    expect(Object.isFrozen(recommendation.enabledSubagents)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY)).toBe(
      true,
    );
    expect(Object.isFrozen(historyEntry)).toBe(true);
    expect(Object.isFrozen(historyEntry.recommendation)).toBe(true);
    expect(Object.isFrozen(historyEntry.recommendation.enabledTools)).toBe(
      true,
    );
    expect(() =>
      (recommendation.enabledSkills as string[]).push("mutated-skill"),
    ).toThrow(TypeError);
    expect(() =>
      (
        DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY as unknown as Array<
          typeof historyEntry
        >
      ).push(historyEntry),
    ).toThrow(TypeError);
    expect(recommendation.enabledSkills).not.toContain("mutated-skill");
    expect(DEFAULT_AGENT_CAPABILITY_CONTRACT_HISTORY).toHaveLength(1);
  });

  it("recursively freezes recommendations created for future history", () => {
    const future = createAgentCapabilityContractRecommendation(2, {
      ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION,
      enabledSkills: [
        ...DEFAULT_AGENT_CAPABILITY_RECOMMENDATION.enabledSkills,
        "future-skill",
      ],
    });
    expect(Object.isFrozen(future)).toBe(true);
    expect(Object.isFrozen(future.recommendation)).toBe(true);
    expect(Object.isFrozen(future.recommendation.enabledSkills)).toBe(true);
    expect(() =>
      (future.recommendation.enabledSkills as string[]).push("mutation"),
    ).toThrow(TypeError);
    expect(future.recommendation.enabledSkills).toContain("future-skill");
    expect(future.recommendation.enabledSkills).not.toContain("mutation");
  });
});
