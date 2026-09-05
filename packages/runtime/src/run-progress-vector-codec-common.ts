import type { JsonObject, JsonValue } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import type { RunConvergenceSnapshot } from "./run-convergence-policy.js";
import {
  exactKeys,
  fail,
  hash,
  integerValue,
  nonNegativeInteger,
  object,
  positiveInteger,
} from "./run-progress-payload-primitives.js";
import type { ValidatedRunProgressVector } from "./run-progress-payload-types.js";

export const DIMENSIONS = [
  "workspace",
  "plan",
  "artifact",
  "source",
  "approval",
  "capability",
  "result",
] as const;

export const DELIVERY_READINESS = new Set([
  "no_product",
  "unverified",
  "stale",
  "verification_failed",
  "ready",
]);

export const OPTIONAL_MUTATION_KEYS = [
  "firstWorkspaceMutationTurn",
  "firstWorkspaceMutationElapsedMs",
] as const;

export function normalizedVector(
  value: JsonObject,
  sourceSchemaVersion: 1 | 2,
  eventSeq: number,
  turnCompletedSeq: number,
  input: {
    projectionId?: string;
    predecessor: string;
    snapshot?: Partial<RunConvergenceSnapshot>;
  },
): ValidatedRunProgressVector {
  const snapshot = input.snapshot ?? {};
  return {
    sourceSchemaVersion,
    decisionEligible: sourceSchemaVersion === 2,
    eventSeq,
    turnCompletedSeq,
    ...(input.projectionId ? { projectionId: input.projectionId } : {}),
    predecessorContentSha256: input.predecessor,
    turnIndex: integerValue(value["turnIndex"]),
    elapsedMs: integerValue(value["elapsedMs"]),
    progressed: snapshot.progressed ?? value["progressed"] === true,
    productProgressed:
      snapshot.productProgressed ?? value["productProgressed"] === true,
    acceptanceProgressed:
      snapshot.acceptanceProgressed ?? value["acceptanceProgressed"] === true,
    supportProgressed:
      snapshot.supportProgressed ?? value["supportProgressed"] === true,
    regressed: snapshot.regressed ?? value["regressed"] === true,
    stagnantTurnCount: integerValue(value["stagnantTurnCount"]),
    stagnantElapsedMs: integerValue(value["stagnantElapsedMs"]),
    acquisitionOnlyTurnCount:
      snapshot.acquisitionOnlyTurnCount ??
      integerValue(value["acquisitionOnlyTurnCount"]),
    acquisitionStagnantTurnCount:
      snapshot.acquisitionStagnantTurnCount ??
      integerValue(value["acquisitionStagnantTurnCount"]),
    supportCount: snapshot.supportCount ?? integerValue(value["supportCount"]),
    acquisitionAttemptCount:
      snapshot.acquisitionAttemptCount ??
      integerValue(value["acquisitionAttemptCount"]),
    acquisitionAttemptCountSinceProgress:
      snapshot.acquisitionAttemptCountSinceProgress ??
      integerValue(value["acquisitionAttemptCountSinceProgress"]),
    acquisitionAdvanceCountSinceProgress:
      snapshot.acquisitionAdvanceCountSinceProgress ??
      integerValue(value["acquisitionAdvanceCountSinceProgress"]),
    productCount: snapshot.productCount ?? integerValue(value["productCount"]),
    acceptanceCount:
      snapshot.acceptanceCount ?? integerValue(value["acceptanceCount"]),
    failureFingerprintCount: integerValue(value["failureFingerprintCount"]),
    failureDomainCount:
      snapshot.failureDomainCount ?? integerValue(value["failureDomainCount"]),
    failureDomainCountSinceProgress:
      snapshot.failureDomainCountSinceProgress ??
      integerValue(value["failureDomainCountSinceProgress"]),
    unclassifiedActivityCountSinceProgress:
      snapshot.unclassifiedActivityCountSinceProgress ??
      integerValue(value["unclassifiedActivityCountSinceProgress"]),
    contentSha256: String(value["contentSha256"]),
    rawPayload: value,
  };
}

export function validateOptionalMutationPair(
  value: JsonObject,
  eventSeq: number,
): void {
  const turn = value["firstWorkspaceMutationTurn"];
  const elapsed = value["firstWorkspaceMutationElapsedMs"];
  if ((turn === undefined) !== (elapsed === undefined)) {
    fail(
      "payload_shape",
      "First workspace mutation fields must occur together",
      eventSeq,
    );
  }
  if (turn === undefined) return;
  const firstTurn = positiveInteger(
    turn,
    "firstWorkspaceMutationTurn",
    eventSeq,
  );
  const firstElapsed = nonNegativeInteger(
    elapsed,
    "firstWorkspaceMutationElapsedMs",
    eventSeq,
  );
  if (
    firstTurn > integerValue(value["turnIndex"]) ||
    firstElapsed > integerValue(value["elapsedMs"])
  ) {
    fail(
      "payload_shape",
      "First workspace mutation exceeds the vector cursor",
      eventSeq,
    );
  }
}

export function validateChangedDimensions(
  value: JsonValue | undefined,
  eventSeq: number,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => DIMENSIONS.includes(item as never))
  ) {
    return fail(
      "payload_shape",
      "Run progress changedDimensions is invalid",
      eventSeq,
    );
  }
  const result = value as string[];
  const sorted = DIMENSIONS.filter((dimension) => result.includes(dimension));
  if (
    new Set(result).size !== result.length ||
    canonicalJson(result) !== canonicalJson(sorted)
  ) {
    fail(
      "payload_shape",
      "Run progress changedDimensions is not canonical",
      eventSeq,
    );
  }
  return result;
}

export function validateHashObject(
  value: JsonValue | undefined,
  keys: readonly string[],
  label: string,
  eventSeq: number,
): void {
  const candidate = object(value, eventSeq, label);
  exactKeys(candidate, keys, [], eventSeq);
  for (const key of keys) hash(candidate[key], `${label}.${key}`, eventSeq);
}

export function validateCountObject(
  value: JsonValue | undefined,
  keys: readonly string[],
  label: string,
  eventSeq: number,
): void {
  const candidate = object(value, eventSeq, label);
  exactKeys(candidate, keys, [], eventSeq);
  for (const key of keys)
    nonNegativeInteger(candidate[key], `${label}.${key}`, eventSeq);
}

export function validateOpenCountObject(
  value: JsonValue | undefined,
  label: string,
  eventSeq: number,
): void {
  const candidate = object(value, eventSeq, label);
  for (const [key, count] of Object.entries(candidate)) {
    if (!key) fail("payload_shape", `${label} has an empty key`, eventSeq);
    nonNegativeInteger(count, `${label}.${key}`, eventSeq);
  }
}
