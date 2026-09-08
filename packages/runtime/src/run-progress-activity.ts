import { canonicalJson, sha256 } from "./ed25519.js";

/** Execution liveness is independent of semantic improvement and acceptance. */
export interface RunProgressActivity {
  progressed: boolean;
  stagnantTurnCount: number;
  stagnantElapsedMs: number;
  acquisitionTurnCountSinceProgress: number;
}

interface ActivityVector {
  turnIndex: number;
  progressed: boolean;
  regressed: boolean;
  supportProgressed: boolean;
  productCount: number;
  elapsedMs: number;
  stagnantTurnCount: number;
  stagnantElapsedMs: number;
  acquisitionAttemptCount: number;
  activity?: RunProgressActivity;
}

export function projectRunProgressActivity(
  current: ActivityVector,
  previous?: ActivityVector,
): RunProgressActivity {
  // Counts contain distinct resource/state receipts, not calls, output bytes,
  // timestamps, or model claims. Revisiting A after A -> B grants no credit.
  const progressed =
    current.progressed ||
    (!current.regressed &&
      (current.supportProgressed ||
        current.productCount > (previous?.productCount ?? 0)));
  const elapsedDelta = current.elapsedMs - (previous?.elapsedMs ?? 0);
  return {
    progressed,
    stagnantTurnCount: progressed
      ? 0
      : (previous?.activity?.stagnantTurnCount ??
          previous?.stagnantTurnCount ??
          0) + 1,
    stagnantElapsedMs: progressed
      ? 0
      : (previous?.activity?.stagnantElapsedMs ??
          previous?.stagnantElapsedMs ??
          0) + elapsedDelta,
    acquisitionTurnCountSinceProgress: current.progressed
      ? 0
      : (previous?.activity?.acquisitionTurnCountSinceProgress ?? 0) +
        Number(
          current.acquisitionAttemptCount >
            (previous?.acquisitionAttemptCount ?? 0),
        ),
  };
}

/** New evidence buys bounded working time; it never certifies the product. */
export function hasRunActivityLease(
  vector: ActivityVector,
  policy: {
    readonly noProgressTurnThreshold: number;
    readonly noProgressElapsedMs: number;
  },
  checkpoint?: { turnIndex: number; elapsedMs: number },
): boolean {
  const activity = vector.activity;
  return (
    activity !== undefined &&
    activity.stagnantTurnCount < vector.stagnantTurnCount &&
    activity.stagnantTurnCount < policy.noProgressTurnThreshold &&
    activity.stagnantElapsedMs < policy.noProgressElapsedMs &&
    // Inspection, implementation and verification share one bounded window.
    // Novel hashes cannot extend it indefinitely without objective progress.
    (checkpoint
      ? vector.turnIndex - checkpoint.turnIndex <
          policy.noProgressTurnThreshold &&
        vector.elapsedMs - checkpoint.elapsedMs < policy.noProgressElapsedMs
      : vector.stagnantTurnCount < policy.noProgressTurnThreshold * 3 &&
        vector.stagnantElapsedMs < policy.noProgressElapsedMs)
  );
}

export function withRunProgressActivity<
  T extends ActivityVector & { contentSha256: string; schemaVersion: number },
>(vector: T, previous?: ActivityVector) {
  const {
    contentSha256: _previousHash,
    schemaVersion: _previousVersion,
    ...base
  } = vector;
  const content = {
    ...base,
    schemaVersion: 3 as const,
    activity: projectRunProgressActivity(vector, previous),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function vectorProjectionId(
  runId: string,
  turnCompletedSeq: number,
): string {
  return sha256(
    canonicalJson({
      kind: "napier.run-progress-vector",
      schemaVersion: 3,
      runId,
      turnCompletedSeq,
    }),
  );
}
