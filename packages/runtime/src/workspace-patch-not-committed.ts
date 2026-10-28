import type { JsonObject, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  patchEventPayload,
  preparedPatchForBoundary,
  type PatchPreparationReceipt,
} from "./workspace-patch-preparation.js";

export function patchCommitWasNotEntered(
  events: RunEvent[],
  prepared: RunEvent & { payload: PatchPreparationReceipt },
): boolean {
  return (
    prepared.payload.schemaVersion === 2 &&
    !events.some(
      (event) =>
        event.runId === prepared.runId &&
        event.threadId === prepared.threadId &&
        [
          "workspace.patch.commit_started",
          "tool.completed",
          "tool.failed",
        ].includes(event.type) &&
        (patchEventPayload(event)["callId"] === prepared.payload.callId ||
          patchEventPayload(event)["operationId"] ===
            prepared.payload.operationId),
    )
  );
}

export function patchNotCommittedPayload(
  prepared: RunEvent & { payload: PatchPreparationReceipt },
): JsonObject {
  const content = {
    schemaVersion: 1,
    status: "commit_not_entered",
    callId: prepared.payload.callId,
    operationId: prepared.payload.operationId,
    effectBoundaryEventSeq: prepared.payload.boundaryEventSeq,
    preparedEventSeq: prepared.seq,
    preparedSha256: prepared.payload.contentSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

/** The missing marker is meaningful only for the v2 mandatory commit gate. */
export function notCommittedPatchForBoundary(
  events: RunEvent[],
  boundary: RunEvent,
): RunEvent | undefined {
  const prepared = preparedPatchForBoundary(events, boundary);
  if (!prepared || !patchCommitWasNotEntered(events, prepared))
    return undefined;
  const proofs = events.filter(
    (event) =>
      event.type === "workspace.patch.not_committed" &&
      event.runId === boundary.runId &&
      event.threadId === boundary.threadId &&
      patchEventPayload(event)["operationId"] === prepared.payload.operationId,
  );
  const proof = proofs[0];
  return proofs.length === 1 &&
    proof &&
    proof.seq > prepared.seq &&
    canonicalJson(proof.payload) ===
      canonicalJson(patchNotCommittedPayload(prepared))
    ? proof
    : undefined;
}
