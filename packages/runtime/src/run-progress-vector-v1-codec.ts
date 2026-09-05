import type { JsonValue } from "@napier/contracts";

import {
  boolean,
  exactKeys,
  fail,
  hash,
  integerValue,
  nonNegativeInteger,
  object,
  positiveInteger,
  predecessorHash,
  validateContentHash,
} from "./run-progress-payload-primitives.js";
import type { ValidatedRunProgressVector } from "./run-progress-payload-types.js";
import {
  DIMENSIONS,
  normalizedVector,
  OPTIONAL_MUTATION_KEYS,
  validateChangedDimensions,
  validateHashObject,
  validateOpenCountObject,
  validateOptionalMutationPair,
} from "./run-progress-vector-codec-common.js";

const VECTOR_V1_REQUIRED_KEYS = [
  "kind",
  "schemaVersion",
  "turnIndex",
  "turnCompletedSeq",
  "elapsedMs",
  "progressed",
  "changedDimensions",
  "stagnantTurnCount",
  "stagnantElapsedMs",
  "workspaceMutationCount",
  "sourceCount",
  "approvalCount",
  "capabilityStatusCount",
  "userResultCount",
  "planCount",
  "planRevisionTotal",
  "planStatusCounts",
  "stepStatusCounts",
  "artifactCount",
  "artifactCandidateCount",
  "artifactStatusCounts",
  "failureFingerprintCount",
  "failureFingerprintSetSha256",
  "dimensions",
  "predecessorContentSha256",
  "contentSha256",
] as const;

/** Explicit compatibility boundary for the vector emitted before protocol v2. */
export function upcastLegacyRunProgressVectorV1(
  payload: JsonValue,
  context: { eventSeq: number },
): ValidatedRunProgressVector {
  const value = object(payload, context.eventSeq);
  exactKeys(
    value,
    VECTOR_V1_REQUIRED_KEYS,
    OPTIONAL_MUTATION_KEYS,
    context.eventSeq,
  );
  if (
    value["kind"] !== "napier.run-progress-vector" ||
    value["schemaVersion"] !== 1
  ) {
    fail(
      "payload_schema",
      "Legacy Run progress vector is not v1",
      context.eventSeq,
    );
  }
  validateContentHash(value, context.eventSeq);
  boolean(value["progressed"], "progressed", context.eventSeq);
  const counters = VECTOR_V1_REQUIRED_KEYS.filter(
    (key) =>
      key.endsWith("Count") ||
      key.endsWith("TurnCount") ||
      key === "turnIndex" ||
      key === "turnCompletedSeq" ||
      key === "elapsedMs" ||
      key === "stagnantElapsedMs" ||
      key === "planRevisionTotal",
  );
  for (const key of counters)
    nonNegativeInteger(value[key], key, context.eventSeq);
  const turnCompletedSeq = positiveInteger(
    value["turnCompletedSeq"],
    "turnCompletedSeq",
    context.eventSeq,
  );
  positiveInteger(value["turnIndex"], "turnIndex", context.eventSeq);
  const changed = validateChangedDimensions(
    value["changedDimensions"],
    context.eventSeq,
  );
  if (value["progressed"] !== changed.length > 0) {
    fail(
      "payload_shape",
      "Legacy Run progress vector progressed flag disagrees with changedDimensions",
      context.eventSeq,
    );
  }
  validateHashObject(
    value["dimensions"],
    DIMENSIONS,
    "dimensions",
    context.eventSeq,
  );
  for (const key of [
    "planStatusCounts",
    "stepStatusCounts",
    "artifactStatusCounts",
  ]) {
    validateOpenCountObject(value[key], key, context.eventSeq);
  }
  hash(
    value["failureFingerprintSetSha256"],
    "failureFingerprintSetSha256",
    context.eventSeq,
  );
  const predecessor = predecessorHash(
    value["predecessorContentSha256"],
    context.eventSeq,
  );
  validateOptionalMutationPair(value, context.eventSeq);

  // Legacy dimension changes are hydration baselines, not current policy evidence.
  const productProgressed = false;
  const supportProgressed = changed.includes("source");
  return normalizedVector(value, 1, context.eventSeq, turnCompletedSeq, {
    predecessor,
    snapshot: {
      progressed: productProgressed,
      productProgressed,
      acceptanceProgressed: false,
      supportProgressed,
      regressed: false,
      acquisitionOnlyTurnCount: 0,
      acquisitionStagnantTurnCount: 0,
      supportCount: integerValue(value["sourceCount"]),
      acquisitionAttemptCount: 0,
      acquisitionAttemptCountSinceProgress: 0,
      acquisitionAdvanceCountSinceProgress: 0,
      productCount:
        integerValue(value["workspaceMutationCount"]) +
        integerValue(value["artifactCandidateCount"]) +
        integerValue(value["userResultCount"]),
      acceptanceCount: 0,
      failureDomainCount: 0,
      failureDomainCountSinceProgress: 0,
      unclassifiedActivityCountSinceProgress: 0,
    },
  });
}
