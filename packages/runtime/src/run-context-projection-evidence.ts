import type { ContextProjectionReceiptV1, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  checkpointHasResponseBinding,
  contextEvidenceRecord,
  parseRunContextCheckpoint,
  RUN_CONTEXT_COMPACTED_EVENT,
  RUN_CONTEXT_PROJECTED_EVENT,
} from "./run-context-checkpoint.js";

export function assertRunContextProjectionBinding(
  events: readonly RunEvent[],
  event: RunEvent,
  receipt: ContextProjectionReceiptV1,
  pruning: RunEvent | undefined,
  pressure: RunEvent | undefined,
): void {
  if (!receipt.runCompactionReceiptSha256) {
    if (
      pruning &&
      pressure &&
      events.some(
        (candidate) =>
          candidate.runId === event.runId &&
          candidate.type === RUN_CONTEXT_PROJECTED_EVENT &&
          candidate.seq > pruning.seq &&
          candidate.seq < pressure.seq,
      )
    )
      throw invalid();
    return;
  }
  const stage = events.find(
    (candidate) =>
      candidate.runId === event.runId &&
      candidate.seq < event.seq &&
      candidate.type === RUN_CONTEXT_PROJECTED_EVENT &&
      contextEvidenceRecord(candidate.payload)["contentSha256"] ===
        receipt.runCompactionReceiptSha256,
  );
  if (
    !stage ||
    !pruning ||
    !pressure ||
    stage.seq <= pruning.seq ||
    stage.seq >= pressure.seq
  )
    throw invalid();
  const { contentSha256, ...payload } = contextEvidenceRecord(stage.payload);
  if (
    sha256(canonicalJson(payload)) !== contentSha256 ||
    payload["kind"] !== "napier.run-context-projection" ||
    payload["schemaVersion"] !== 1 ||
    payload["runId"] !== event.runId ||
    payload["modelAttempt"] !== receipt.modelAttempt ||
    payload["recoveryAttempt"] !== receipt.recoveryAttempt ||
    payload["activeMessageCount"] !== receipt.preparedMessageCount ||
    payload["activeMessageSetSha256"] !== receipt.preparedMessageSetSha256
  )
    throw invalid();
  const previous =
    receipt.recoveryAttempt === 0
      ? undefined
      : events
          .filter(
            (candidate) =>
              candidate.runId === event.runId &&
              candidate.seq < stage.seq &&
              candidate.type === "context.projected",
          )
          .at(-1);
  const expectedOriginal =
    receipt.recoveryAttempt === 0
      ? receipt.postPruningMessageSetSha256
      : contextEvidenceRecord(previous?.payload)["activeMessageSetSha256"];
  if (payload["originalMessageSetSha256"] !== expectedOriginal) throw invalid();
  const checkpointEvent = events.find(
    (candidate) =>
      candidate.runId === event.runId &&
      candidate.seq < stage.seq &&
      candidate.type === RUN_CONTEXT_COMPACTED_EVENT &&
      contextEvidenceRecord(candidate.payload)["contentSha256"] ===
        payload["checkpointSha256"],
  );
  assertCheckpointChain(events, event.runId, checkpointEvent);
}

function assertCheckpointChain(
  events: readonly RunEvent[],
  runId: string,
  checkpointEvent: RunEvent | undefined,
): void {
  let current = checkpointEvent;
  let childSourceCount = Infinity;
  while (current) {
    const checkpoint = parseRunContextCheckpoint(current.payload);
    if (
      !checkpoint ||
      checkpoint.runId !== runId ||
      checkpoint.sourceMessageCount >= childSourceCount ||
      !checkpointHasResponseBinding(checkpoint, events, current.seq)
    )
      throw invalid();
    if (!checkpoint.parentCheckpointSha256) return;
    childSourceCount = checkpoint.sourceMessageCount;
    const childSeq = current.seq;
    current = events.find(
      (candidate) =>
        candidate.runId === runId &&
        candidate.seq < childSeq &&
        candidate.type === RUN_CONTEXT_COMPACTED_EVENT &&
        contextEvidenceRecord(candidate.payload)["contentSha256"] ===
          checkpoint.parentCheckpointSha256,
    );
  }
  throw invalid();
}

function invalid(): Error {
  return new Error("Run context projection source binding is invalid");
}
