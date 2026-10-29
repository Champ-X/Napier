import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { ModelThinkingLoopEvidence } from "./model-thinking-loop-policy.js";

declare const THINKING_SUPPRESSION: unique symbol;
export interface ModelThinkingSuppressionProof { readonly [THINKING_SUPPRESSION]: true }
interface SuppressionBinding {
  responseSha256: string;
  evidenceSha256: string;
  physicalId?: string;
  attributionSha256?: string;
  envelopeSha256?: string;
}
const proofs = new WeakMap<object, Readonly<SuppressionBinding>>();

/** Guard-only issuance after it has withheld all executable output. This is
 * process-local authority and is never serialized into provider or replay data. */
export function issueModelThinkingSuppression(input: { message: AssistantMessage;
  evidence: ModelThinkingLoopEvidence; attribution?: ModelCallAttributionV1 }): ModelThinkingSuppressionProof {
  const proof = Object.freeze({}) as ModelThinkingSuppressionProof;
  proofs.set(proof, Object.freeze({ responseSha256: sha256(canonicalJson(input.message)),
    evidenceSha256: sha256(canonicalJson(input.evidence)), ...(input.attribution ? {
      physicalId: input.attribution.physicalId, attributionSha256: input.attribution.contentSha256,
      envelopeSha256: input.attribution.capture.envelope.contentSha256,
    } : {}) }));
  return proof;
}

export function readModelThinkingSuppression(proof: ModelThinkingSuppressionProof): Readonly<SuppressionBinding> {
  const binding = proofs.get(proof);
  if (!binding) throw new Error("Thinking suppression requires private guard proof");
  return binding;
}
