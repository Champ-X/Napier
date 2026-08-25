import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
} from "@napier/contracts";
import { MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS } from "@napier/runtime/governance";

import { requestRecord } from "./http-request-validation.js";
import {
  isNonNegativeInteger,
  isSha256Hex,
  MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT,
  validSha256List,
} from "./receipt-trust-http-validation-primitives.js";

const MAX_RECEIPT_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

export function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "maxEnvelopeAgeMs",
    "expectedEnvelopeSha256",
    "expectedProposalSha256",
    "expectedActivationDecisionRecordId",
    "expectedCurrentSelectionSha256",
    "requiredSignerKeyIds",
  ]);
  if (!record) return undefined;
  const maxEnvelopeAgeMs = record["maxEnvelopeAgeMs"];
  const expectedEnvelopeSha256 = optionalSha256(record["expectedEnvelopeSha256"]);
  const expectedProposalSha256 = optionalSha256(record["expectedProposalSha256"]);
  const expectedActivationDecisionRecordId = record["expectedActivationDecisionRecordId"];
  const expectedCurrentSelectionSha256 = optionalSha256(
    record["expectedCurrentSelectionSha256"],
    true,
  );
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  if (
    !validOptionalAge(maxEnvelopeAgeMs) ||
    expectedEnvelopeSha256 === null ||
    expectedProposalSha256 === null ||
    expectedCurrentSelectionSha256 === null ||
    (expectedActivationDecisionRecordId !== undefined &&
      (typeof expectedActivationDecisionRecordId !== "string" ||
        !/^trustqad_[a-z0-9]{8,80}$/.test(expectedActivationDecisionRecordId))) ||
    !validSha256List(requiredSignerKeyIds, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS)
  ) return undefined;
  return {
    ...(typeof maxEnvelopeAgeMs === "number" ? { maxEnvelopeAgeMs } : {}),
    ...(expectedEnvelopeSha256 !== undefined ? { expectedEnvelopeSha256 } : {}),
    ...(expectedProposalSha256 !== undefined ? { expectedProposalSha256 } : {}),
    ...(typeof expectedActivationDecisionRecordId === "string"
      ? { expectedActivationDecisionRecordId }
      : {}),
    ...(expectedCurrentSelectionSha256 !== undefined
      ? { expectedCurrentSelectionSha256 }
      : {}),
    ...(Array.isArray(requiredSignerKeyIds) && requiredSignerKeyIds.length > 0
      ? { requiredSignerKeyIds: requiredSignerKeyIds as string[] }
      : {}),
  };
}

export function parseReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: unknown,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, [
    "maxEnvelopeAgeMs",
    "expectedCheckpointSha256",
    "expectedSelectionSetSha256",
    "expectedSelectionChainTailSha256",
    "minimumSelectionCount",
    "requiredSignerKeyIds",
    "rejectRollback",
  ]);
  if (!record) return undefined;
  const maxEnvelopeAgeMs = record["maxEnvelopeAgeMs"];
  const expectedCheckpointSha256 = optionalSha256(record["expectedCheckpointSha256"], true);
  const expectedSelectionSetSha256 = optionalSha256(record["expectedSelectionSetSha256"], true);
  const expectedSelectionChainTailSha256 = optionalSha256(record["expectedSelectionChainTailSha256"], true);
  const minimumSelectionCount = record["minimumSelectionCount"];
  const requiredSignerKeyIds = record["requiredSignerKeyIds"];
  const rejectRollback = record["rejectRollback"];
  if (
    !validOptionalAge(maxEnvelopeAgeMs) ||
    expectedCheckpointSha256 === null ||
    expectedSelectionSetSha256 === null ||
    expectedSelectionChainTailSha256 === null ||
    (minimumSelectionCount !== undefined &&
      (!isNonNegativeInteger(minimumSelectionCount) ||
        minimumSelectionCount > MAX_RECEIPT_TRUST_CHECKPOINT_SELECTION_COUNT)) ||
    !validSha256List(requiredSignerKeyIds, MAX_RECEIPT_TRUST_DIRECTORY_SUBSCRIPTIONS) ||
    (rejectRollback !== undefined && typeof rejectRollback !== "boolean")
  ) return undefined;
  return {
    ...(typeof maxEnvelopeAgeMs === "number" ? { maxEnvelopeAgeMs } : {}),
    ...(expectedCheckpointSha256 !== undefined ? { expectedCheckpointSha256 } : {}),
    ...(expectedSelectionSetSha256 !== undefined ? { expectedSelectionSetSha256 } : {}),
    ...(expectedSelectionChainTailSha256 !== undefined
      ? { expectedSelectionChainTailSha256 }
      : {}),
    ...(minimumSelectionCount !== undefined ? { minimumSelectionCount } : {}),
    ...(requiredSignerKeyIds !== undefined
      ? { requiredSignerKeyIds: Array.from(new Set(requiredSignerKeyIds as string[])).sort() }
      : {}),
    ...(rejectRollback !== undefined ? { rejectRollback } : {}),
  };
}

function optionalSha256(
  value: unknown,
  allowEmpty = false,
): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" &&
    ((allowEmpty && value === "") || isSha256Hex(value))
    ? value
    : null;
}

function validOptionalAge(value: unknown): boolean {
  return (
    value === undefined ||
    (isNonNegativeInteger(value) && value <= MAX_RECEIPT_AGE_MS)
  );
}
