import type {
  AgentProfile,
  AgentProfileRevision,
  CredentialReference,
  ModelSummary,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

import { recommendedDefaultRunModel } from "../src/default-run-model.js";

describe("default Run model recommendation", () => {
  it("uses the first explicitly configured live model for the untouched seed Agent", () => {
    expect(
      recommendedDefaultRunModel(
        [
          model("napier", "demo", true),
          model("deepseek", "deepseek-v4-flash", true),
          model("openrouter", "auto", true),
        ],
        [credential("deepseek")],
        agent({ provider: "napier", id: "demo" }),
        [revision(1, [])],
      ),
    ).toEqual({ provider: "deepseek", id: "deepseek-v4-flash" });
  });

  it("does not trust configured catalog rows without an active credential reference", () => {
    expect(
      recommendedDefaultRunModel(
        [
          model("napier", "demo", true),
          model("deepseek", "deepseek-v4-flash", true),
        ],
        [],
        agent({ provider: "napier", id: "demo" }),
        [revision(1, [])],
      ),
    ).toEqual({ provider: "napier", id: "demo" });
  });

  it("preserves custom Agents and an explicit model revision", () => {
    const models = [
      model("napier", "demo", true),
      model("deepseek", "deepseek-v4-flash", true),
    ];
    const credentials = [credential("deepseek")];

    expect(
      recommendedDefaultRunModel(
        models,
        credentials,
        { ...agent({ provider: "napier", id: "demo" }), id: "agent_custom" },
        [revision(1, [])],
      ),
    ).toEqual({ provider: "napier", id: "demo" });
    expect(
      recommendedDefaultRunModel(
        models,
        credentials,
        agent({ provider: "napier", id: "demo" }),
        [revision(1, []), revision(2, ["model"])],
      ),
    ).toEqual({ provider: "napier", id: "demo" });
  });
});

function model(
  provider: string,
  id: string,
  configured: boolean,
): ModelSummary {
  return {
    provider,
    providerName: provider,
    id,
    name: id,
    contextWindow: 100_000,
    reasoning: true,
    vision: false,
    configured,
  };
}

function credential(providerId: string): CredentialReference {
  return {
    id: `credential_${providerId}_12345678`,
    providerId,
    label: providerId,
    source: { type: "environment", variable: "EXPLICIT_API_KEY" },
    status: "active",
    availability: "available",
    revision: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function agent(modelRef: AgentProfile["model"]): AgentProfile {
  return {
    id: "agent_napier",
    name: "Napier",
    description: "Test",
    systemPrompt: "Test prompt.",
    model: modelRef,
    thinkingLevel: "medium",
    toolPolicy: "observe",
    enabledTools: [],
    enabledSkills: [],
    enabledSubagents: [],
    subagentLimits: {
      maxConcurrent: 1,
      maxTotal: 1,
      maxTurns: 1,
      timeoutMs: 1_000,
    },
    runLimits: {
      maxTurns: 1,
      maxTotalTokens: 1_000,
      maxCostUsd: 1,
      timeoutMs: 1_000,
    },
    revision: 1,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  };
}

function revision(
  value: number,
  changedFields: AgentProfileRevision["changedFields"],
): Pick<AgentProfileRevision, "revision" | "changedFields"> {
  return { revision: value, changedFields };
}
