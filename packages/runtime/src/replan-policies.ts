import type {
  AgentProfile,
  ExecutionPlanReplanPolicyPosture,
  ExecutionPlanReplanPolicyTemplate,
  ModelRef,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

export function createReplanPolicyTemplate(input: {
  model: ModelRef;
  thinkingLevel: AgentProfile["thinkingLevel"];
}): ExecutionPlanReplanPolicyTemplate {
  const posture = derivePosture(input.model, input.thinkingLevel);
  const content = {
    id: `napier.replan.policy.${posture}.v1`,
    label: policyLabel(posture),
    model: {
      provider: input.model.provider,
      id: input.model.id,
    },
    thinkingLevel: input.thinkingLevel,
    posture,
    maxDraftSteps: maxDraftSteps(posture),
    checklist: policyChecklist(posture),
    instruction: policyInstruction(posture),
  } satisfies Omit<ExecutionPlanReplanPolicyTemplate, "templateSha256">;
  return {
    ...content,
    templateSha256: sha256(canonicalJson(content)),
  };
}

function derivePosture(
  model: ModelRef,
  thinkingLevel: AgentProfile["thinkingLevel"],
): ExecutionPlanReplanPolicyPosture {
  if (
    model.provider === "napier" ||
    thinkingLevel === "off" ||
    thinkingLevel === "minimal"
  ) {
    return "conservative";
  }
  const modelKey = `${model.provider}/${model.id}`.toLowerCase();
  if (
    thinkingLevel === "high" ||
    modelKey.includes("gpt-4") ||
    modelKey.includes("claude") ||
    modelKey.includes("gemini") ||
    modelKey.includes("deepseek") ||
    modelKey.includes("doubao")
  ) {
    return "expansive";
  }
  return "balanced";
}

function maxDraftSteps(posture: ExecutionPlanReplanPolicyPosture): number {
  if (posture === "conservative") return 1;
  if (posture === "balanced") return 2;
  return 4;
}

function policyLabel(posture: ExecutionPlanReplanPolicyPosture): string {
  if (posture === "conservative") return "Conservative replan";
  if (posture === "balanced") return "Balanced replan";
  return "Expansive replan";
}

function policyInstruction(posture: ExecutionPlanReplanPolicyPosture): string {
  if (posture === "conservative") {
    return "Prefer the smallest replacement that restores the blocked path, keep existing verification criteria, and avoid broad dependency rewrites.";
  }
  if (posture === "balanced") {
    return "Generate a bounded replacement path, update directly dependent steps, and add only artifacts needed to restore verification.";
  }
  return "Consider parallel replacement work, artifact recovery, and downstream dependency rewrites while preserving completed evidence.";
}

function policyChecklist(posture: ExecutionPlanReplanPolicyPosture): string[] {
  const common = [
    "Use the recommendation expectedRevision unchanged.",
    "Preserve completed step evidence and verified artifact hashes.",
    "Keep every new step independently verifiable.",
  ];
  if (posture === "conservative") {
    return [
      ...common,
      "Add at most one replacement step unless the operator explicitly expands the plan.",
    ];
  }
  if (posture === "balanced") {
    return [
      ...common,
      "Rewrite only dependencies that directly reference superseded steps.",
    ];
  }
  return [
    ...common,
    "Group replacement work into coherent parallel branches when that shortens the critical path.",
  ];
}
