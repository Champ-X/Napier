import type { ModelSummary } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelProviderGroups,
  modelSelectOption,
} from "../src/model-selection-view-model";

describe("model selection view model", () => {
  it("groups models by provider with configured counts", () => {
    const groups = modelProviderGroups([
      model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", false),
      model("openai", "gpt-4.1", "GPT-4.1", true),
      model("napier", "demo", "Deterministic demo", true),
      model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", false),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "napier · built in",
      "openai · 1/1 configured",
      "deepseek · 0/2 configured",
    ]);
    expect(groups[2]?.options.map((option) => option.key)).toEqual([
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
    ]);
  });

  it("labels unavailable model options without changing their keys", () => {
    expect(
      modelSelectOption(
        model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", false),
      ),
    ).toEqual({
      key: "deepseek/deepseek-v4-flash",
      label: "deepseek / DeepSeek V4 Flash · unavailable",
      configured: false,
      provider: "deepseek",
    });
  });
});

function model(
  provider: string,
  id: string,
  name: string,
  configured: boolean,
): ModelSummary {
  return {
    provider,
    providerName: provider,
    id,
    name,
    contextWindow: 100_000,
    reasoning: true,
    vision: false,
    configured,
  };
}
