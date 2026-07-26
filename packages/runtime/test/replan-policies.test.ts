import { describe, expect, it } from "vitest";

import { createReplanPolicyTemplate } from "../src/replan-policies.js";

describe("replan policy templates", () => {
  it("derives deterministic policy templates from model and thinking level", () => {
    expect(
      createReplanPolicyTemplate({
        model: { provider: "napier", id: "demo" },
        thinkingLevel: "high",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "napier.replan.policy.conservative.v1",
        posture: "conservative",
        maxDraftSteps: 1,
        templateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    expect(
      createReplanPolicyTemplate({
        model: { provider: "openai", id: "gpt-4.1" },
        thinkingLevel: "medium",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "napier.replan.policy.expansive.v1",
        posture: "expansive",
        maxDraftSteps: 4,
        templateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    expect(
      createReplanPolicyTemplate({
        model: { provider: "custom", id: "small-planner" },
        thinkingLevel: "low",
      }),
    ).toEqual(
      expect.objectContaining({
        id: "napier.replan.policy.balanced.v1",
        posture: "balanced",
        maxDraftSteps: 2,
        templateSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
