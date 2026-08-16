export type RunNoProgressReason = "turns" | "elapsed";

export interface RunNoProgressEvidence {
  reason: RunNoProgressReason;
  turnIndex: number;
  stagnantTurnCount: number;
  elapsedMs: number;
  stagnantElapsedMs: number;
  thresholdTurns: number;
  thresholdElapsedMs: number;
  taskIntentSha256: string;
  progressVectorSha256: string;
  rerouteContentSha256: string;
}

export class RunNoProgressError extends Error {
  constructor(readonly evidence: RunNoProgressEvidence) {
    super(
      `Run made no measurable progress after its one reroute: ${evidence.reason} (${String(evidence.stagnantTurnCount)} turns, ${String(evidence.stagnantElapsedMs)} ms).`,
    );
    this.name = "RunNoProgressError";
  }
}
