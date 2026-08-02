import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy = {},
): Required<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy> {
  const requiredSignerKeyIds = Array.from(
    new Set(input.requiredSignerKeyIds ?? []),
  ).sort();
  if (!validCheckpointDiscoveryPolicy(input, requiredSignerKeyIds)) {
    throw new Error(
      "Receipt trust anchor directory quorum activation selection checkpoint discovery policy is invalid",
    );
  }
  return {
    maxEnvelopeAgeMs: input.maxEnvelopeAgeMs ?? 7 * 24 * 60 * 60 * 1_000,
    expectedCheckpointSha256: input.expectedCheckpointSha256 ?? "",
    expectedSelectionSetSha256: input.expectedSelectionSetSha256 ?? "",
    expectedSelectionChainTailSha256:
      input.expectedSelectionChainTailSha256 ?? "",
    minimumSelectionCount: input.minimumSelectionCount ?? 0,
    requiredSignerKeyIds,
    rejectRollback: input.rejectRollback ?? true,
  };
}

function validCheckpointDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy,
  requiredSignerKeyIds: string[],
): boolean {
  const expectedHashes = [
    input.expectedCheckpointSha256,
    input.expectedSelectionSetSha256,
    input.expectedSelectionChainTailSha256,
  ];
  return (
    Number.isSafeInteger(input.maxEnvelopeAgeMs ?? 0) &&
    validOptionalRange(input.maxEnvelopeAgeMs, 0, 365 * 24 * 60 * 60 * 1_000) &&
    expectedHashes.every(
      (value) =>
        value === undefined || value === "" || SHA256_PATTERN.test(value),
    ) &&
    validOptionalRange(input.minimumSelectionCount, 0, 1_000) &&
    requiredSignerKeyIds.every((keyId) => SHA256_PATTERN.test(keyId)) &&
    (input.rejectRollback === undefined ||
      typeof input.rejectRollback === "boolean")
  );
}

function validOptionalRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value >= minimum && value <= maximum)
  );
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy = {},
): string {
  return sha256(
    canonicalJson(
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy(
        input,
      ),
    ),
  );
}

export function normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy = {},
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy {
  const requiredSignerKeyIds =
    input.requiredSignerKeyIds === undefined
      ? undefined
      : Array.from(new Set(input.requiredSignerKeyIds)).sort();
  return {
    ...(input.maxEnvelopeAgeMs !== undefined
      ? { maxEnvelopeAgeMs: input.maxEnvelopeAgeMs }
      : {}),
    ...(input.expectedEnvelopeSha256
      ? { expectedEnvelopeSha256: input.expectedEnvelopeSha256 }
      : {}),
    ...(input.expectedProposalSha256
      ? { expectedProposalSha256: input.expectedProposalSha256 }
      : {}),
    ...(input.expectedActivationDecisionRecordId
      ? {
          expectedActivationDecisionRecordId:
            input.expectedActivationDecisionRecordId,
        }
      : {}),
    ...(input.expectedCurrentSelectionSha256 !== undefined
      ? { expectedCurrentSelectionSha256: input.expectedCurrentSelectionSha256 }
      : {}),
    ...(requiredSignerKeyIds && requiredSignerKeyIds.length > 0
      ? { requiredSignerKeyIds }
      : {}),
  };
}

export function hashReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
  input: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy = {},
): string {
  return sha256(
    canonicalJson(
      normalizeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy(
        input,
      ),
    ),
  );
}
