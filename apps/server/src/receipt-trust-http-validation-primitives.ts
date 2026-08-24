import { requestRecord } from "./http-request-validation.js";

import {
  MAX_RECEIPT_TRUST_ANCHORS,
  MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS,
} from "@napier/runtime";
import type {
  ReceiptTrustAnchorDirectoryVerificationPolicy,
} from "@napier/contracts";

export const MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT = 1_000;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validSha256List(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= maxLength &&
      value.every((item) => isSha256Hex(item)))
  );
}

export function parseReceiptTrustAnchorDirectoryVerificationPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryVerificationPolicy | undefined {
  if (input === undefined) return undefined;
  const record = requestRecord(input, [
    "maxAgeMs",
    "expectedAnchorSetSha256",
    "minimumTrustedCount",
    "requiredTrustedKeyIds",
  ]);
  if (!record) return undefined;
  const maxAgeMs = record["maxAgeMs"];
  const expectedAnchorSetSha256 = record["expectedAnchorSetSha256"];
  const minimumTrustedCount = record["minimumTrustedCount"];
  const requiredTrustedKeyIds = record["requiredTrustedKeyIds"];
  if (
    (maxAgeMs !== undefined && !isNonNegativeInteger(maxAgeMs)) ||
    (expectedAnchorSetSha256 !== undefined &&
      !isSha256Hex(expectedAnchorSetSha256)) ||
    (minimumTrustedCount !== undefined &&
      !isNonNegativeInteger(minimumTrustedCount)) ||
    !validSha256List(requiredTrustedKeyIds, MAX_RECEIPT_TRUST_ANCHORS)
  ) {
    return undefined;
  }
  return {
    ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
    ...(expectedAnchorSetSha256 !== undefined
      ? { expectedAnchorSetSha256 }
      : {}),
    ...(minimumTrustedCount !== undefined ? { minimumTrustedCount } : {}),
    ...(requiredTrustedKeyIds !== undefined
      ? {
          requiredTrustedKeyIds: Array.from(
            new Set(requiredTrustedKeyIds as string[]),
          ).sort(),
        }
      : {}),
  };
}

export function validSubscriptionCount(value: unknown): value is number {
  return (
    isNonNegativeInteger(value) &&
    value >= 1 &&
    value <= MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS
  );
}
