import { fauxProvider } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { HARNESS_POLICY_PRESET_IDS } from "@napier/contracts/harness-experiments";
import {
  presetHarnessPolicy,
  createHarnessPolicyProfile,
} from "../src/harness-policy-profile.js";
import {
  bindRunHarnessProfile,
  createModelHarnessExperimentProfile,
  modelHarnessExperimentProfileApplied,
} from "../src/model-harness-experiment-profile.js";
import { applyModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { resolveModelHarnessResolution } from "../src/model-harness-resolution.js";
import { inheritedHarnessPolicyOptions } from "../src/harness-run-policy.js";
import type { RunEvent } from "@napier/contracts";
import type { RunPromptOptions } from "../src/agent-runtime-options.js";

type BindingOptions = Pick<
  RunPromptOptions,
  "harnessPolicyPreset" | "harnessExperimentProfile"
> & { text?: string };

it("requires stable assembly for tail delivery and keeps existing presets unchanged", () => {
  const {
    contentSha256: _hash,
    schemaVersion: _version,
    ...base
  } = presetHarnessPolicy("coding-node.v1");
  expect(base.context.delivery).toBeUndefined();
  expect(
    createHarnessPolicyProfile({
      ...base,
      context: { ...base.context, delivery: "tail-v1" },
    }).context.delivery,
  ).toBe("tail-v1");
  expect(() =>
    createHarnessPolicyProfile({
      ...base,
      context: { ...base.context, prompt: "legacy", delivery: "tail-v1" },
    }),
  ).toThrow("Invalid Harness");
});

it("binds explicit presets to independent versioned compositions without changing the implicit default", () => {
  const ordinary: BindingOptions = { text: "task" };
  expect(bindRunHarnessProfile(ordinary)).toBe(ordinary);
  for (const id of HARNESS_POLICY_PRESET_IDS) {
    const bound = bindRunHarnessProfile<BindingOptions>({
      text: "task",
      harnessPolicyPreset: id,
      harnessExperimentProfile: undefined,
    });
    expect(bound.harnessPolicyPreset).toBeUndefined();
    expect(bound.harnessExperimentProfile).toMatchObject({
      id: `napier.harness-preset.${id}`,
      maxActiveTools: 32,
      maxActiveToolsMode: "model_default",
      policies: {
        id,
        revision: 1,
        context: {
          prompt: "stable-v1",
          memory: "task-aware-v1",
          workingState: "evidence-v1",
        },
        toolSurface: { editReferences: id !== "research.v1" },
        verification: id === "coding-python.v1" ? "node-python-v1" : "node-v1",
      },
    });
    const originalHash = bound.harnessExperimentProfile!.contentSha256;
    bound.harnessExperimentProfile!.policies!.context.memory = "legacy";
    const next = bindRunHarnessProfile<BindingOptions>({
      harnessPolicyPreset: id,
      harnessExperimentProfile: undefined,
    });
    expect(next.harnessExperimentProfile!.contentSha256).toBe(originalHash);
    expect(() =>
      bindRunHarnessProfile({
        harnessPolicyPreset: id,
        harnessExperimentProfile: next.harnessExperimentProfile,
      }),
    ).toThrow("not both");
  }
  expect(() =>
    presetHarnessPolicy("coding-node.v2" as "coding-node.v1"),
  ).toThrow("Unknown");
});

it("preserves the bound profile across model-family recovery while respecting each serving limit", () => {
  const profile = bindRunHarnessProfile<BindingOptions>({
    harnessPolicyPreset: "coding-node.v1" as const,
    harnessExperimentProfile: undefined,
  }).harnessExperimentProfile!;
  const receipt = modelHarnessExperimentProfileApplied({
    profile,
    receiptSha256: "a".repeat(64),
  });
  const recovered = inheritedHarnessPolicyOptions(
    [
      {
        runId: "run_original",
        type: "harness.experiment.profile.applied",
        payload: receipt,
      } as RunEvent,
    ],
    "run_original",
  ).harnessExperimentProfile!;
  expect(recovered).toEqual(profile);
  for (const [provider, api, id, limit] of [
    ["deepseek", "openai-completions", "deepseek-v4-flash", 28],
    ["generic", "custom-api", "unknown", 24],
    ["openai", "openai-responses", "gpt-5.4", 20],
  ] as const) {
    const model = fauxProvider({ provider, api, models: [{ id }] }).getModel();
    const resolution = resolveModelHarnessResolution({
      model,
      messages: [],
      tools: [],
    });
    expect(
      applyModelHarnessExperimentProfile(model, resolution, recovered)
        .maxActiveTools,
    ).toBe(limit);
    expect(recovered.contentSha256).toBe(profile.contentSha256);
  }
  const generic = fauxProvider({
    provider: "generic",
    api: "custom-api",
  }).getModel();
  expect(() =>
    applyModelHarnessExperimentProfile(
      generic,
      resolveModelHarnessResolution({
        model: generic,
        messages: [],
        tools: [],
      }),
      createModelHarnessExperimentProfile({ id: "fixed", maxActiveTools: 28 }),
    ),
  ).toThrow("family tool limit");
});
