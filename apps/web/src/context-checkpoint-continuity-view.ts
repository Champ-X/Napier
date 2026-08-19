import type { RunEvent } from "@napier/contracts";

import { contextCheckpointPayload } from "./context-checkpoint-payload";

export type ContextCheckpointContinuityState = "bound" | "legacy_unbound";

export interface ContextCheckpointContinuityView {
  eventSeq: number;
  runId: string;
  checkpointId: string;
  fromSeq: number;
  toSeq: number;
  retainedFromSeq: number;
  sourceEventCount: number;
  continuityEventCount?: number;
  continuitySha256?: string;
  sourceSha256: string;
  summarySha256: string;
  decisionCount: number;
  openLoopCount: number;
  artifactCount: number;
  state: ContextCheckpointContinuityState;
}

export function contextCheckpointContinuityViews(
  events: readonly RunEvent[],
): ContextCheckpointContinuityView[] {
  return events.flatMap((event) => {
    if (event.type !== "context.compaction.completed") return [];
    const checkpoint = contextCheckpointPayload(event.payload);
    if (!checkpoint) return [];
    const bound = checkpoint.continuityProjectionVersion === 1;
    return [
      {
        eventSeq: event.seq,
        runId: event.runId,
        checkpointId: checkpoint.checkpointId,
        fromSeq: checkpoint.fromSeq,
        toSeq: checkpoint.toSeq,
        retainedFromSeq: checkpoint.retainedFromSeq,
        sourceEventCount: checkpoint.sourceEventCount,
        ...(bound
          ? {
              continuityEventCount: checkpoint.continuityEventCount,
              continuitySha256: checkpoint.continuitySha256,
            }
          : {}),
        sourceSha256: checkpoint.sourceSha256,
        summarySha256: checkpoint.summarySha256,
        decisionCount: checkpoint.decisions.length,
        openLoopCount: checkpoint.openLoops.length,
        artifactCount: checkpoint.artifacts.length,
        state: bound ? "bound" : "legacy_unbound",
      },
    ];
  });
}
