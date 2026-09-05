import type { JsonObject } from "@napier/contracts";

import type { ValidatedRunProgressVector } from "./run-progress-payload-types.js";

/** Uses normalized codec fields while retaining v2-only projection details. */
export function normalizedRunProgressHydrationPayload(
  vector: ValidatedRunProgressVector,
): JsonObject {
  return {
    ...vector.rawPayload,
    turnIndex: vector.turnIndex,
    stagnantTurnCount: vector.stagnantTurnCount,
    stagnantElapsedMs: vector.stagnantElapsedMs,
    acquisitionOnlyTurnCount: vector.acquisitionOnlyTurnCount,
    acquisitionStagnantTurnCount: vector.acquisitionStagnantTurnCount,
    acquisitionAttemptCount: vector.acquisitionAttemptCount,
    acquisitionAttemptCountSinceProgress:
      vector.acquisitionAttemptCountSinceProgress,
    acquisitionAdvanceCountSinceProgress:
      vector.acquisitionAdvanceCountSinceProgress,
    failureDomainCountSinceProgress: vector.failureDomainCountSinceProgress,
    unclassifiedActivityCountSinceProgress:
      vector.unclassifiedActivityCountSinceProgress,
  };
}
