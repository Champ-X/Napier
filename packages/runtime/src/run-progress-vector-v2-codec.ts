import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  boolean,
  exactKeys,
  fail,
  hash,
  nonNegativeInteger,
  object,
  positiveInteger,
  predecessorHash,
  validateContentHash,
} from "./run-progress-payload-primitives.js";
import type { ValidatedRunProgressVector } from "./run-progress-payload-types.js";
import {
  DELIVERY_READINESS,
  DIMENSIONS,
  normalizedVector,
  OPTIONAL_MUTATION_KEYS,
  validateChangedDimensions,
  validateCountObject,
  validateHashObject,
  validateOpenCountObject,
  validateOptionalMutationPair,
} from "./run-progress-vector-codec-common.js";

const VECTOR_V2_REQUIRED_KEYS = [
  "kind",
  "schemaVersion",
  "projectionId",
  "turnIndex",
  "turnCompletedSeq",
  "elapsedMs",
  "progressed",
  "productProgressed",
  "acceptanceProgressed",
  "supportProgressed",
  "regressed",
  "changedDimensions",
  "stagnantTurnCount",
  "stagnantElapsedMs",
  "acquisitionOnlyTurnCount",
  "acquisitionStagnantTurnCount",
  "workspaceMutationCount",
  "sourceCount",
  "productCount",
  "supportCount",
  "supportResourceCount",
  "acquisitionAttemptCount",
  "acquisitionAttemptCountSinceProgress",
  "acquisitionAdvanceCountSinceProgress",
  "failureDomainCountSinceProgress",
  "unclassifiedActivityCountSinceProgress",
  "deliveryReadiness",
  "deliveryReadinessBlockerCount",
  "productEffectCount",
  "marginalProductAdvancedCount",
  "marginalProductRegressedCount",
  "indeterminateProductEffectCount",
  "invalidMarginalEvidenceCount",
  "unboundVerificationCount",
  "deliveryAttemptCount",
  "explicitAcceptanceCount",
  "acceptanceCount",
  "controlCount",
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
  "failureDomainCount",
  "failureDomainSetSha256",
  "progressScores",
  "dimensions",
  "predecessorContentSha256",
  "contentSha256",
] as const;

/** Strictly decodes the current vector protocol without defaulting absent fields. */
export function decodeRunProgressVectorV2(
  payload: JsonValue,
  context: { runId: string; eventSeq: number },
): ValidatedRunProgressVector {
  const value = object(payload, context.eventSeq);
  exactKeys(
    value,
    VECTOR_V2_REQUIRED_KEYS,
    OPTIONAL_MUTATION_KEYS,
    context.eventSeq,
  );
  if (
    value["kind"] !== "napier.run-progress-vector" ||
    value["schemaVersion"] !== 2
  ) {
    fail(
      "payload_schema",
      "Run progress vector is not current v2",
      context.eventSeq,
    );
  }
  validateContentHash(value, context.eventSeq);
  const turnCompletedSeq = positiveInteger(
    value["turnCompletedSeq"],
    "turnCompletedSeq",
    context.eventSeq,
  );
  const expectedProjectionId = sha256(
    canonicalJson({
      kind: "napier.run-progress-vector",
      schemaVersion: 2,
      runId: context.runId,
      turnCompletedSeq,
    }),
  );
  if (value["projectionId"] !== expectedProjectionId) {
    fail(
      "projection_id",
      "Run progress vector projectionId is not bound to its Run and completed turn",
      context.eventSeq,
    );
  }
  for (const key of [
    "progressed",
    "productProgressed",
    "acceptanceProgressed",
    "supportProgressed",
    "regressed",
  ]) {
    boolean(value[key], key, context.eventSeq);
  }
  if (
    value["progressed"] !==
    (value["productProgressed"] === true ||
      value["acceptanceProgressed"] === true)
  ) {
    fail(
      "payload_shape",
      "Run progress vector progressed flag disagrees with product/acceptance progress",
      context.eventSeq,
    );
  }
  const counters = VECTOR_V2_REQUIRED_KEYS.filter(
    (key) =>
      key.endsWith("Count") ||
      key.endsWith("TurnCount") ||
      key === "turnIndex" ||
      key === "elapsedMs" ||
      key === "stagnantElapsedMs" ||
      key === "planRevisionTotal",
  );
  for (const key of [
    ...counters,
    "acquisitionAttemptCountSinceProgress",
    "acquisitionAdvanceCountSinceProgress",
    "failureDomainCountSinceProgress",
    "unclassifiedActivityCountSinceProgress",
  ]) {
    nonNegativeInteger(value[key], key, context.eventSeq);
  }
  positiveInteger(value["turnIndex"], "turnIndex", context.eventSeq);
  if (!DELIVERY_READINESS.has(String(value["deliveryReadiness"]))) {
    fail(
      "payload_shape",
      "Run progress vector deliveryReadiness is invalid",
      context.eventSeq,
    );
  }
  validateChangedDimensions(value["changedDimensions"], context.eventSeq);
  validateHashObject(
    value["dimensions"],
    DIMENSIONS,
    "dimensions",
    context.eventSeq,
  );
  validateCountObject(
    value["progressScores"],
    ["planProduct", "planAcceptance", "artifactProduct", "artifactAcceptance"],
    "progressScores",
    context.eventSeq,
  );
  const scores = value["progressScores"] as Record<string, JsonValue>;
  if (
    value["sourceCount"] !== value["supportResourceCount"] ||
    Number(value["controlCount"]) !==
      Number(value["approvalCount"]) + Number(value["capabilityStatusCount"]) ||
    Number(value["acquisitionAdvanceCountSinceProgress"]) >
      Number(value["acquisitionAttemptCountSinceProgress"]) ||
    Number(value["failureDomainCountSinceProgress"]) >
      Number(value["failureDomainCount"]) ||
    (value["deliveryReadiness"] === "ready" &&
      value["deliveryReadinessBlockerCount"] !== 0) ||
    Number(value["productCount"]) <
      Number(scores["planProduct"]) + Number(scores["artifactProduct"]) ||
    Number(value["acceptanceCount"]) <
      Number(value["explicitAcceptanceCount"]) +
        Number(scores["planAcceptance"]) +
        Number(scores["artifactAcceptance"]) ||
    Number(value["marginalProductAdvancedCount"]) +
      Number(value["marginalProductRegressedCount"]) +
      Number(value["indeterminateProductEffectCount"]) +
      Number(value["invalidMarginalEvidenceCount"]) >
      Number(value["productEffectCount"]) ||
    Number(value["explicitAcceptanceCount"]) >
      Number(value["deliveryAttemptCount"]) ||
    (value["progressed"] === true && value["stagnantTurnCount"] !== 0)
  ) {
    fail(
      "payload_shape",
      "Run progress vector counters violate producer invariants",
      context.eventSeq,
    );
  }
  for (const key of [
    "planStatusCounts",
    "stepStatusCounts",
    "artifactStatusCounts",
  ]) {
    validateOpenCountObject(value[key], key, context.eventSeq);
  }
  for (const key of [
    "failureFingerprintSetSha256",
    "failureDomainSetSha256",
    "contentSha256",
  ]) {
    hash(value[key], key, context.eventSeq);
  }
  const predecessor = predecessorHash(
    value["predecessorContentSha256"],
    context.eventSeq,
  );
  validateOptionalMutationPair(value, context.eventSeq);
  return normalizedVector(value, 2, context.eventSeq, turnCompletedSeq, {
    projectionId: expectedProjectionId,
    predecessor,
  });
}
