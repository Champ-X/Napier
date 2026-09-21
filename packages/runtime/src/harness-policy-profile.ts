import type { HarnessPolicyProfile } from "@napier/contracts/harness-experiments";
import {
  HARNESS_POLICY_PRESET_IDS,
  type HarnessPolicyPresetId,
} from "@napier/contracts/harness-experiments";
import { canonicalJson, sha256 } from "./ed25519.js";
import { validEditFormatPreference } from "./edit-format-preference.js";

/** Explicit experimental presets. Existing IDs never change composition;
 * a changed strategy requires a new versioned ID. No preset grants tools. */
export function presetHarnessPolicy(
  id: HarnessPolicyPresetId,
): HarnessPolicyProfile {
  if (!HARNESS_POLICY_PRESET_IDS.includes(id))
    throw new Error("Unknown Harness policy preset");
  return createHarnessPolicyProfile({
    id,
    revision: 1,
    context: {
      prompt: "stable-v1",
      memory: "task-aware-v1",
      workingState: "evidence-v1",
    },
    toolSurface: { editReferences: id !== "research.v1" },
    verification: id === "coding-python.v1" ? "node-python-v1" : "node-v1",
  });
}

export function createHarnessPolicyProfile(
  input: Omit<HarnessPolicyProfile, "schemaVersion" | "contentSha256">,
): HarnessPolicyProfile {
  const content = { schemaVersion: 1 as const, ...structuredClone(input) };
  return validateHarnessPolicyProfile({
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  });
}

export function validateHarnessPolicyProfile(
  input: unknown,
): HarnessPolicyProfile {
  if (!record(input) || !record(input.context) || !record(input.toolSurface))
    invalid();
  const { contentSha256, ...content } = input;
  if (
    ![
      "contentSha256,context,id,revision,schemaVersion,toolSurface,verification",
      "contentSha256,context,id,modelCall,revision,schemaVersion,toolSurface,verification",
    ].includes(Object.keys(input).sort().join()) ||
    (Object.hasOwn(input, "modelCall") && input.modelCall !== "bounded-thinking-v1") ||
    input.schemaVersion !== 1 ||
    typeof input.id !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,79}$/u.test(input.id) ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 1 ||
    !validContextPolicy(input.context) ||
    ![
      "editReferences",
      "editReferences,unifiedDiff",
      "editPreference,editReferences",
      "editPreference,editReferences,unifiedDiff",
    ].includes(Object.keys(input.toolSurface).sort().join()) ||
    typeof input.toolSurface.editReferences !== "boolean" ||
    (input.toolSurface.editPreference !== undefined &&
      (!validEditFormatPreference(input.toolSurface.editPreference) ||
        (input.toolSurface.editPreference.dialect === "unified_diff" &&
          input.toolSurface.unifiedDiff !== true))) ||
    (input.toolSurface.unifiedDiff !== undefined &&
      (typeof input.toolSurface.unifiedDiff !== "boolean" ||
        !input.toolSurface.editReferences)) ||
    !["node-v1", "node-python-v1"].includes(String(input.verification)) ||
    contentSha256 !== sha256(canonicalJson(content))
  )
    invalid();
  return structuredClone(input) as unknown as HarnessPolicyProfile;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validContextPolicy(context: Record<string, unknown>): boolean {
  return (
    [
      "memory,prompt,workingState",
      "delivery,memory,prompt,workingState",
      "finalization,memory,prompt,workingState",
      "delivery,finalization,memory,prompt,workingState",
    ].includes(
      Object.keys(context)
        .filter(
          (key) =>
            !["validation", "verificationOrder", "planning"].includes(key),
        )
        .sort()
        .join(),
    ) &&
    (context.planning === undefined ||
      context.planning === "proportional-v1") &&
    (context.validation === undefined ||
      ["contract-first-v1", "contract-transitions-v2", "contract-staged-v3"].includes(
        context.validation as string,
      )) &&
    (context.verificationOrder === undefined ||
      (context.verificationOrder === "before-first-patch-v1" &&
        context.validation !== undefined)) &&
    (context.finalization === undefined ||
      context.finalization === "request-aware-v1" ||
      context.finalization === "request-aware-v2") &&
    (context.delivery === undefined ||
      (context.delivery === "tail-v1" && context.prompt === "stable-v1")) &&
    ["legacy", "stable-v1"].includes(String(context.prompt)) &&
    [
      "legacy",
      "task-aware-v1",
      "task-aware-selective-v2",
      "task-aware-grouped-v3",
    ].includes(String(context.memory)) &&
    ["legacy", "evidence-v1"].includes(String(context.workingState))
  );
}

function invalid(): never {
  throw new Error("Invalid Harness policy profile");
}
