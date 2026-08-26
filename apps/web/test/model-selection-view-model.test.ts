import type { ModelSummary } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  configuredModelProviderGroups,
  modelPickerGroups,
  modelProviderGroups,
  modelSelectOption,
  recentModelKeysFromRuns,
  reviewerModelAvailability,
  selectedModelAvailability,
} from "../src/model-selection-view-model";
import { recommendedDefaultRunModel } from "@napier/contracts/default-run-model";

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

  it("filters qualification groups to executable configured models", () => {
    const groups = configuredModelProviderGroups([
      model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
      model("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro", false),
      model("openrouter", "auto", "OpenRouter Auto", false),
      model("napier", "demo", "Deterministic demo", true),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "napier · built in",
      "deepseek · 1/2 configured",
    ]);
    expect(groups.flatMap((group) => group.options)).toEqual([
      expect.objectContaining({
        key: "napier/demo",
        configured: true,
      }),
      expect.objectContaining({
        key: "deepseek/deepseek-v4-flash",
        configured: true,
      }),
    ]);
  });

  it("pins the Agent default and recent models before provider groups", () => {
    const groups = modelPickerGroups(
      [
        model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
        model("openai", "gpt-5", "GPT-5", true),
        model("openai", "gpt-4.1", "GPT-4.1", false),
        model("napier", "demo", "Deterministic demo", true),
      ],
      {
        recommendedModelKeys: ["openai/gpt-5"],
        recentModelKeys: ["deepseek/deepseek-v4-flash", "openai/gpt-5"],
      },
    );

    expect(groups.map((group) => group.id)).toEqual([
      "recommended",
      "recent",
      "provider:napier",
    ]);
    expect(groups[0]?.options.map((option) => option.key)).toEqual([
      "openai/gpt-5",
    ]);
    expect(groups[1]?.options.map((option) => option.key)).toEqual([
      "deepseek/deepseek-v4-flash",
    ]);
    expect(groups.flatMap((group) => group.options)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "openai/gpt-4.1" })]),
    );
  });

  it("searches model metadata and only reveals unavailable models explicitly", () => {
    const models = [
      model("openai", "gpt-5", "GPT-5", true),
      model("openai", "gpt-4.1", "GPT-4.1", false),
      model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
    ];
    expect(
      modelPickerGroups(models, { query: "gpt" })
        .flatMap((group) => group.options)
        .map((option) => option.key),
    ).toEqual(["openai/gpt-5"]);
    expect(
      modelPickerGroups(models, { query: "gpt", showUnavailable: true })
        .flatMap((group) => group.options)
        .map((option) => option.key),
    ).toEqual(["openai/gpt-5", "openai/gpt-4.1"]);
  });

  it("derives recent model order from settled run configuration", () => {
    const runs = [
      { configuration: { model: { provider: "openai", id: "gpt-5" } } },
      {
        configuration: {
          model: { provider: "deepseek", id: "deepseek-v4-flash" },
        },
      },
      { configuration: { model: { provider: "openai", id: "gpt-5" } } },
    ];
    expect(recentModelKeysFromRuns(runs as never)).toEqual([
      "openai/gpt-5",
      "deepseek/deepseek-v4-flash",
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

  it("projects selected model run availability", () => {
    const models = [
      model("napier", "demo", "Deterministic demo", true),
      model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", false),
    ];

    expect(selectedModelAvailability(models, "napier/demo")).toEqual({
      key: "napier/demo",
      provider: "napier",
      id: "demo",
      label: "napier / Deterministic demo",
      configured: true,
      known: true,
    });
    expect(
      selectedModelAvailability(models, "deepseek/deepseek-v4-flash"),
    ).toEqual({
      key: "deepseek/deepseek-v4-flash",
      provider: "deepseek",
      id: "deepseek-v4-flash",
      label: "deepseek / DeepSeek V4 Flash",
      configured: false,
      known: true,
    });
    expect(selectedModelAvailability(models, "missing/model")).toEqual({
      key: "missing/model",
      provider: "missing",
      id: "model",
      label: "missing/model",
      configured: false,
      known: false,
    });
  });

  it("requires an independent configured live reviewer model", () => {
    const models = [
      model("napier", "demo", "Deterministic demo", true),
      model("openai", "gpt-4.1", "GPT-4.1", true),
      model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", false),
    ];

    expect(reviewerModelAvailability(models, "", "openai/gpt-4.1")).toEqual({
      available: true,
    });
    expect(
      reviewerModelAvailability(models, "openai/gpt-4.1", "openai/gpt-4.1"),
    ).toEqual({
      available: false,
      model: expect.objectContaining({ key: "openai/gpt-4.1" }),
      reason: "same_as_primary",
    });
    expect(
      reviewerModelAvailability(models, "napier/demo", "openai/gpt-4.1"),
    ).toEqual({
      available: false,
      model: expect.objectContaining({ key: "napier/demo" }),
      reason: "demo_not_allowed",
    });
    expect(
      reviewerModelAvailability(
        models,
        "deepseek/deepseek-v4-flash",
        "openai/gpt-4.1",
      ),
    ).toEqual({
      available: false,
      model: expect.objectContaining({
        key: "deepseek/deepseek-v4-flash",
        configured: false,
      }),
      reason: "unconfigured",
    });
    expect(
      reviewerModelAvailability(models, "openai/gpt-4.1", "napier/demo"),
    ).toEqual({
      available: true,
      model: expect.objectContaining({ key: "openai/gpt-4.1" }),
    });
  });

  it("projects the same live-ready default used by Runtime", () => {
    expect(
      recommendedDefaultRunModel(
        [
          model("napier", "demo", "Deterministic demo", true),
          model("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash", true),
        ],
        [
          {
            id: "credential_deepseek_12345678",
            providerId: "deepseek",
            label: "DeepSeek",
            source: {
              type: "environment",
              variable: "DEEPSEEK_API_KEY",
            },
            status: "active",
            availability: "available",
            revision: 1,
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
        ],
        {
          id: "agent_napier",
          model: { provider: "napier", id: "demo" },
        },
        [{ revision: 1, changedFields: [] }],
      ),
    ).toEqual({ provider: "deepseek", id: "deepseek-v4-flash" });
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
