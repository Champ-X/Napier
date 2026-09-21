import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  HarnessExperimentProfile,
  HarnessPolicyProfile,
  HarnessPolicyPresetId,
} from "@napier/contracts/harness-experiments";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  presetHarnessPolicy,
  validateHarnessPolicyProfile,
} from "./harness-policy-profile.js";
import { withWorkspaceEditReferences } from "./workspace-edit-reference-tools.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  withToolchainProviders,
  type ToolchainOptions,
} from "./toolchain-provider.js";
import {
  resolveModelHarnessProfile,
  type ModelHarnessResolution,
} from "./model-harness-resolution.js";

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;

export type ModelHarnessExperimentProfile = HarnessExperimentProfile;

export function bindRunHarnessProfile<
  T extends {
    harnessExperimentProfile?: ModelHarnessExperimentProfile;
    harnessPolicyPreset?: HarnessPolicyPresetId;
  },
>(options: T): T {
  if (options.harnessPolicyPreset !== undefined) {
    if (options.harnessExperimentProfile !== undefined)
      throw new Error(
        "Choose a Harness policy preset or an explicit profile, not both",
      );
    const { harnessPolicyPreset, ...rest } = options;
    return {
      ...rest,
      harnessExperimentProfile: createModelHarnessExperimentProfile({
        id: `napier.harness-preset.${harnessPolicyPreset}`,
        maxActiveTools: 32,
        maxActiveToolsMode: "model_default",
        policies: presetHarnessPolicy(harnessPolicyPreset),
      }),
    } as T;
  }
  return options.harnessExperimentProfile
    ? {
        ...options,
        harnessExperimentProfile: validateModelHarnessExperimentProfile(
          options.harnessExperimentProfile,
        ),
      }
    : options;
}

export function createModelHarnessExperimentProfile(input: {
  id: string;
  maxActiveTools: number;
  maxActiveToolsMode?: "model_default";
  policies?: HarnessPolicyProfile;
}): ModelHarnessExperimentProfile {
  const content = {
    kind: "napier.model-harness-experiment-profile" as const,
    schemaVersion: 1 as const,
    id: input.id,
    maxActiveTools: input.maxActiveTools,
    ...(input.maxActiveToolsMode !== undefined
      ? { maxActiveToolsMode: input.maxActiveToolsMode }
      : {}),
    ...(input.policies
      ? { policies: validateHarnessPolicyProfile(input.policies) }
      : {}),
  };
  const profile = {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
  return validateModelHarnessExperimentProfile(profile);
}

export function validateModelHarnessExperimentProfile(
  input: unknown,
): ModelHarnessExperimentProfile {
  if (!record(input)) {
    throw new Error("Model Harness experiment profile is invalid");
  }
  const { contentSha256, ...content } = input;
  if (
    Object.keys(input).length !==
      5 +
        Number(input["policies"] !== undefined) +
        Number(input["maxActiveToolsMode"] !== undefined) ||
    (input["maxActiveToolsMode"] !== undefined &&
      input["maxActiveToolsMode"] !== "model_default") ||
    input["kind"] !== "napier.model-harness-experiment-profile" ||
    input["schemaVersion"] !== 1 ||
    typeof input["id"] !== "string" ||
    !PROFILE_ID.test(input["id"]) ||
    !Number.isSafeInteger(input["maxActiveTools"]) ||
    Number(input["maxActiveTools"]) < 1 ||
    typeof contentSha256 !== "string" ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    throw new Error("Model Harness experiment profile is invalid");
  }
  if (input["policies"] !== undefined)
    validateHarnessPolicyProfile(input["policies"]);
  return structuredClone(input) as unknown as ModelHarnessExperimentProfile;
}

export function applyHarnessToolPolicies(
  tools: AgentTool[],
  profile?: ModelHarnessExperimentProfile,
  toolchainOptions?: ToolchainOptions,
): AgentTool[] {
  if (!profile) return tools;
  const policies = validateModelHarnessExperimentProfile(profile).policies;
  let selected = policies?.toolSurface.editReferences
    ? withWorkspaceEditReferences(tools, {
        unifiedDiff: policies.toolSurface.unifiedDiff ?? false,
      })
    : tools;
  if (policies?.verification === "node-python-v1") {
    if (!toolchainOptions)
      throw new Error("Toolchain policy requires a run-bound process provider");
    selected = withToolchainProviders(selected, toolchainOptions);
  }
  return selected;
}

export function applyModelHarnessExperimentProfile(
  model: Pick<Model<Api>, "api">,
  resolution: ModelHarnessResolution,
  profileInput?: ModelHarnessExperimentProfile,
): ModelHarnessResolution {
  if (!profileInput) return resolution;
  const profile = validateModelHarnessExperimentProfile(profileInput);
  const familyLimit = resolveModelHarnessProfile(model).maxActiveTools;
  if (profile.maxActiveToolsMode === "model_default")
    return {
      ...resolution,
      maxActiveTools: Math.min(
        profile.maxActiveTools,
        resolution.maxActiveTools,
        familyLimit,
      ),
    };
  if (profile.maxActiveTools > familyLimit) {
    throw new Error(
      `Model Harness experiment profile exceeds the family tool limit: ${profile.id}/${String(profile.maxActiveTools)}/${String(familyLimit)}`,
    );
  }
  return { ...resolution, maxActiveTools: profile.maxActiveTools };
}

export function modelHarnessExperimentProfileApplied(input: {
  profile: ModelHarnessExperimentProfile;
  receiptSha256: string;
}): Record<string, string | number> {
  const profile = validateModelHarnessExperimentProfile(input.profile);
  const content = {
    kind: "napier.model-harness-experiment-profile-applied",
    schemaVersion: 1,
    profileId: profile.id,
    profileSha256: profile.contentSha256,
    maxActiveTools: profile.maxActiveTools,
    ...(profile.maxActiveToolsMode
      ? { maxActiveToolsMode: profile.maxActiveToolsMode }
      : {}),
    ...(profile.policies
      ? { policyProfileJson: canonicalJson(profile.policies) }
      : {}),
    modelHarnessReceiptSha256: input.receiptSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
