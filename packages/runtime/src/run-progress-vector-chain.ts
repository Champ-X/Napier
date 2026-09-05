import type { RunEvent } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  fail,
  integerValue,
  object,
  orderedRunEvents,
  validateEnvelopeSchema,
} from "./run-progress-payload-primitives.js";
import type { ValidatedRunProgressVector } from "./run-progress-payload-types.js";
import { DIMENSIONS } from "./run-progress-vector-codec-common.js";
import { upcastLegacyRunProgressVectorV1 } from "./run-progress-vector-v1-codec.js";
import { decodeRunProgressVectorV2 } from "./run-progress-vector-v2-codec.js";

/** Validates hashes, completed-turn binding, predecessor links and monotonic cursors. */
export function projectValidatedVectorChain(
  events: readonly RunEvent[],
  runId: string,
): readonly ValidatedRunProgressVector[] {
  const ordered = orderedRunEvents(events, runId);
  const completedTurns = new Set(
    ordered
      .filter((event) => event.type === "turn.completed")
      .map((event) => event.seq),
  );
  const vectors: ValidatedRunProgressVector[] = [];
  const projectionIds = new Set<string>();
  let currentProtocolStarted = false;
  for (const event of ordered) {
    if (event.type !== "run.progress.vector") continue;
    validateEnvelopeSchema(event);
    const payload = object(event.payload, event.seq);
    const schemaVersion = payload["schemaVersion"];
    if (schemaVersion === 1 && currentProtocolStarted) {
      fail(
        "vector_chain",
        "Run progress vector protocol cannot downgrade from v2 to legacy v1",
        event.seq,
      );
    }
    if (schemaVersion === 2) currentProtocolStarted = true;
    const decoded =
      schemaVersion === 2
        ? decodeRunProgressVectorV2(payload, { runId, eventSeq: event.seq })
        : schemaVersion === 1
          ? upcastLegacyRunProgressVectorV1(payload, { eventSeq: event.seq })
          : fail(
              "payload_schema",
              `Unsupported Run progress vector schema ${String(schemaVersion)}`,
              event.seq,
            );
    const vector = normalizeLegacyVectorBaseline(decoded, vectors.at(-1));
    if (
      vector.turnCompletedSeq >= event.seq ||
      !completedTurns.has(vector.turnCompletedSeq)
    ) {
      fail(
        "turn_binding",
        "Run progress vector does not reference an earlier completed turn in this ledger",
        event.seq,
      );
    }
    if (vector.projectionId) {
      if (projectionIds.has(vector.projectionId)) {
        fail("projection_id", "Duplicate Run progress projectionId", event.seq);
      }
      projectionIds.add(vector.projectionId);
    }
    validateVectorSuccessor(vectors.at(-1), vector);
    vectors.push(vector);
  }
  return vectors;
}

function validateVectorSuccessor(
  previous: ValidatedRunProgressVector | undefined,
  current: ValidatedRunProgressVector,
): void {
  if (!previous) {
    if (current.turnIndex !== 1 || current.predecessorContentSha256 !== "") {
      fail(
        "vector_chain",
        "First Run progress vector must start turn 1 with no predecessor",
        current.eventSeq,
      );
    }
    validateVectorDerivedTransition(previous, current);
    return;
  }
  if (
    current.predecessorContentSha256 !== previous.contentSha256 ||
    current.turnIndex !== previous.turnIndex + 1
  ) {
    fail(
      "vector_chain",
      "Run progress vector predecessor or turn chain is broken",
      current.eventSeq,
    );
  }
  if (
    current.turnCompletedSeq <= previous.turnCompletedSeq ||
    current.elapsedMs < previous.elapsedMs
  ) {
    fail(
      "vector_monotonicity",
      "Run progress vector cursor or elapsed time regressed",
      current.eventSeq,
    );
  }
  if (previous.sourceSchemaVersion === 2 && current.sourceSchemaVersion === 2) {
    for (const key of [
      "workspaceMutationCount",
      "supportCount",
      "acquisitionAttemptCount",
      "failureFingerprintCount",
      "failureDomainCount",
    ] as const) {
      if (snapshotCounter(current, key) < snapshotCounter(previous, key)) {
        fail(
          "vector_monotonicity",
          `Run progress vector ${key} regressed`,
          current.eventSeq,
        );
      }
    }
    for (const key of [
      "supportResourceCount",
      "productEffectCount",
      "marginalProductAdvancedCount",
      "marginalProductRegressedCount",
      "indeterminateProductEffectCount",
      "invalidMarginalEvidenceCount",
      "unboundVerificationCount",
      "deliveryAttemptCount",
      "explicitAcceptanceCount",
      "approvalCount",
      "capabilityStatusCount",
      "userResultCount",
    ]) {
      if (
        integerValue(current.rawPayload[key]) <
        integerValue(previous.rawPayload[key])
      ) {
        fail(
          "vector_monotonicity",
          `Run progress vector ${key} regressed`,
          current.eventSeq,
        );
      }
    }
    if (
      !current.regressed &&
      (current.productCount < previous.productCount ||
        current.acceptanceCount < previous.acceptanceCount)
    ) {
      fail(
        "vector_monotonicity",
        "Run progress delivery counts regressed without a recorded regression",
        current.eventSeq,
      );
    }
  }
  if (!current.progressed) {
    for (const key of [
      "acquisitionAttemptCountSinceProgress",
      "acquisitionAdvanceCountSinceProgress",
      "failureDomainCountSinceProgress",
      "unclassifiedActivityCountSinceProgress",
    ] as const) {
      if (current[key] < previous[key]) {
        fail(
          "vector_monotonicity",
          `Run progress vector ${key} regressed without progress`,
          current.eventSeq,
        );
      }
    }
  }
  const expectedStagnant = current.progressed
    ? 0
    : previous.stagnantTurnCount + 1;
  if (current.stagnantTurnCount !== expectedStagnant) {
    fail(
      "vector_monotonicity",
      "Run progress vector stagnantTurnCount is inconsistent",
      current.eventSeq,
    );
  }
  validateVectorDerivedTransition(previous, current);
}

const EMPTY_DIMENSION_SHA256 = sha256(canonicalJson([]));

function validateVectorDerivedTransition(
  previous: ValidatedRunProgressVector | undefined,
  current: ValidatedRunProgressVector,
): void {
  const elapsedDelta = previous
    ? current.elapsedMs - previous.elapsedMs
    : current.elapsedMs;
  const expectedStagnantElapsed = current.progressed
    ? 0
    : (previous?.stagnantElapsedMs ?? 0) + elapsedDelta;
  if (current.stagnantElapsedMs !== expectedStagnantElapsed) {
    fail(
      "vector_monotonicity",
      "Run progress vector stagnantElapsedMs is inconsistent",
      current.eventSeq,
    );
  }
  if (current.sourceSchemaVersion !== 2) return;
  const dimensions = current.rawPayload["dimensions"] as Record<
    string,
    unknown
  >;
  const previousDimensions = previous?.rawPayload["dimensions"] as
    | Record<string, unknown>
    | undefined;
  const expectedChangedDimensions = DIMENSIONS.filter(
    (dimension) =>
      dimensions[dimension] !==
      (previousDimensions?.[dimension] ?? EMPTY_DIMENSION_SHA256),
  );
  if (
    canonicalJson(current.rawPayload["changedDimensions"]) !==
    canonicalJson(expectedChangedDimensions)
  ) {
    fail(
      "vector_monotonicity",
      "Run progress vector changedDimensions disagrees with its dimension transition",
      current.eventSeq,
    );
  }
}

function normalizeLegacyVectorBaseline(
  vector: ValidatedRunProgressVector,
  previous: ValidatedRunProgressVector | undefined,
): ValidatedRunProgressVector {
  if (vector.sourceSchemaVersion !== 1) return vector;
  const elapsedDelta = previous
    ? Math.max(0, vector.elapsedMs - previous.elapsedMs)
    : vector.elapsedMs;
  return {
    ...vector,
    stagnantTurnCount: (previous?.stagnantTurnCount ?? 0) + 1,
    stagnantElapsedMs: (previous?.stagnantElapsedMs ?? 0) + elapsedDelta,
  };
}

function snapshotCounter(
  vector: ValidatedRunProgressVector,
  key:
    | "workspaceMutationCount"
    | "supportCount"
    | "acquisitionAttemptCount"
    | "failureFingerprintCount"
    | "failureDomainCount",
): number {
  if (key in vector)
    return Number(vector[key as keyof ValidatedRunProgressVector] ?? 0);
  return integerValue(vector.rawPayload[key]);
}
