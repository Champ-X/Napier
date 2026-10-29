import type { JsonObject } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { ModelThinkingLoopError, parseModelThinkingLoopError, type ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";
import { readModelThinkingSuppression, type ModelThinkingSuppressionProof } from "./model-thinking-suppression.js";

const claims = new WeakMap<ModelThinkingSuppressionProof, string>();

/** Only a guard-issued proof can create a native suppressed response. Exact
 * retries retain their binding even if the surrounding Store commit failed. */
export function claimChildThinkingSuppression(proof: ModelThinkingSuppressionProof | undefined,
  payload: JsonObject, owner: { threadId: string; runId: string }): void {
  assertChildResponseDisposition(payload);
  if (payload["outputDisposition"] === undefined) {
    if (proof) throw new Error("Child thinking suppression proof has no disposition");
    return;
  }
  if (!proof) throw new Error("Child thinking suppression requires native guard authority");
  const binding = readModelThinkingSuppression(proof);
  if (binding.responseSha256 !== payload["responseSha256"] || binding.evidenceSha256 !== sha256(canonicalJson(payload["thinkingRecovery"])) ||
      binding.physicalId !== payload["physicalId"] || binding.attributionSha256 !== payload["attributionSha256"] ||
      (binding.envelopeSha256 !== undefined && binding.envelopeSha256 !== payload["modelContextEnvelopeSha256"]))
    throw new Error("Child thinking suppression proof differs from its logical attempt");
  const claim = canonicalJson({ ...owner, taskId: payload["subagentTaskId"], executionId: payload["subagentExecutionId"],
    invocationId: payload["childInvocationId"], invocationIndex: payload["invocationIndex"],
    captureSha256: payload["childCaptureSha256"], ...binding });
  const previous = claims.get(proof);
  if (previous !== undefined && previous !== claim) throw new Error("Child thinking suppression proof was already bound to another attempt");
  claims.set(proof, claim);
}

/** Suppression records a policy decision, never rewrites the provider's terminal or usage. */
export function assertChildResponseDisposition(payload: JsonObject): void {
  const disposition = payload["outputDisposition"], recovery = payload["thinkingRecovery"];
  if (disposition === undefined && recovery === undefined) return;
  if (disposition !== "suppressed_thinking_recovery" || payload["subagentPhase"] !== "subagent_turn" ||
      !recovery || typeof recovery !== "object" || Array.isArray(recovery)) invalid();
  const parsed = parseModelThinkingLoopError(new ModelThinkingLoopError(recovery as unknown as ModelThinkingLoopEvidence).message);
  if (!parsed || canonicalJson(parsed.evidence) !== canonicalJson(recovery) ||
      !hash(payload["responseSha256"]) || !hash(payload["modelContextEnvelopeSha256"]) ||
      !["stop", "length", "error", "aborted"].includes(String(payload["stopReason"])) ||
      !Array.isArray(payload["toolCalls"]) || payload["toolCalls"].length !== 0) invalid();
}

export function isDeliveredChildResponse(payload: JsonObject): boolean {
  assertChildResponseDisposition(payload);
  return payload["outputDisposition"] !== "suppressed_thinking_recovery";
}

function hash(value: unknown): boolean { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function invalid(): never { throw new Error("Child response thinking suppression disposition is invalid"); }
