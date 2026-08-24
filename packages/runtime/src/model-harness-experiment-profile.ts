import type { Api, Model } from "@earendil-works/pi-ai";
import type { HarnessExperimentProfile } from "@napier/contracts/harness-experiments";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  resolveModelHarnessProfile,
  type ModelHarnessResolution,
} from "./model-harness-resolution.js";

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;

export type ModelHarnessExperimentProfile = HarnessExperimentProfile;

export function createModelHarnessExperimentProfile(input: {
  id: string;
  maxActiveTools: number;
}): ModelHarnessExperimentProfile {
  const content = {
    kind: "napier.model-harness-experiment-profile" as const,
    schemaVersion: 1 as const,
    id: input.id,
    maxActiveTools: input.maxActiveTools,
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
    Object.keys(input).length !== 5 ||
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
  return structuredClone(input) as unknown as ModelHarnessExperimentProfile;
}

export function applyModelHarnessExperimentProfile(
  model: Pick<Model<Api>, "api">,
  resolution: ModelHarnessResolution,
  profileInput?: ModelHarnessExperimentProfile,
): ModelHarnessResolution {
  if (!profileInput) return resolution;
  const profile = validateModelHarnessExperimentProfile(profileInput);
  const familyLimit = resolveModelHarnessProfile(model).maxActiveTools;
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
    modelHarnessReceiptSha256: input.receiptSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
