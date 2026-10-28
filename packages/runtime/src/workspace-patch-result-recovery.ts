import type { RunEvent } from "@napier/contracts";

import {
  patchRecoveryEvidenceFromDetails,
  settledPatchRecoveryCandidates,
  type SettledPatchRecoveryEvidence,
} from "./run-patch-recovery-evidence.js";
import { WorkspacePatchResultCapsules } from "./workspace-patch-result-capsule.js";
import { canonicalJson, sha256 } from "./ed25519.js";

export interface RetainedPatchResult {
  callId: string;
  operationId: string;
  effectSha256: string;
  source: "settled_result_capsule";
  resultSha256: string;
}

/** Inherit an exact settled result as recovery context. Do not invent a tool
 * response in the old Run or route a write through generic replay APIs. */
export async function loadSettledPatchRecoveryEvidence(
  dataRoot: string,
  events: RunEvent[],
): Promise<{
  patches: SettledPatchRecoveryEvidence[];
  retainedResults: RetainedPatchResult[];
}> {
  const candidates = settledPatchRecoveryCandidates(events);
  if (candidates.length > 128)
    throw new Error("Patch recovery inspection limit exceeded");
  const results = new WorkspacePatchResultCapsules(dataRoot);
  const patches: SettledPatchRecoveryEvidence[] = [];
  const retainedResults: RetainedPatchResult[] = [];
  for (const candidate of candidates) {
    if (candidate.terminal) {
      patches.push(candidate.terminal);
      continue;
    }
    const captured = await results.read(candidate.effectSha256).catch(() => {
      throw new Error("Patch recovery settled result is missing or invalid");
    });
    const patch = patchRecoveryEvidenceFromDetails(
      candidate,
      captured.result.details,
    );
    if (captured.callId !== candidate.callId || !patch) {
      throw new Error("Patch recovery settled result binding changed");
    }
    patches.push(patch);
    retainedResults.push({
      callId: candidate.callId,
      operationId: candidate.operationId,
      effectSha256: candidate.effectSha256,
      source: "settled_result_capsule",
      resultSha256: sha256(canonicalJson(captured.result)),
    });
  }
  return { patches, retainedResults };
}
