import type {
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectorySubscription,
} from "@napier/contracts";

import type { ReceiptTrustControllerState } from "./receipt-trust-controller-types";

export function upsertDirectorySubscriptionState(
  current: ReceiptTrustControllerState,
  value: ReceiptTrustAnchorDirectorySubscription,
): ReceiptTrustControllerState {
  return {
    ...current,
    directorySubscriptions: upsertById(current.directorySubscriptions, value),
  };
}

export function upsertCheckpointSubscriptionState(
  current: ReceiptTrustControllerState,
  value: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription,
): ReceiptTrustControllerState {
  return {
    ...current,
    checkpointSubscriptions: upsertById(current.checkpointSubscriptions, value),
  };
}

export function upsertPromotionBaselineState(
  current: ReceiptTrustControllerState,
  value: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
): ReceiptTrustControllerState {
  return {
    ...current,
    promotionBaselines: upsertById(current.promotionBaselines, value),
  };
}

export function activateDirectorySubscriptionState(
  current: ReceiptTrustControllerState,
  subscription: ReceiptTrustAnchorDirectorySubscription,
): ReceiptTrustControllerState {
  const discovery = subscription.lastGoodDiscovery;
  if (!discovery?.directory) return current;
  return {
    ...current,
    externalDirectory: discovery.directory,
    externalDirectoryPolicy: subscription.policy,
    externalDirectorySubscriptionId: subscription.id,
    directoryDiscovery: discovery,
    directoryVerification: discovery.verification,
  };
}

export function clearExternalDirectoryState(
  current: ReceiptTrustControllerState,
): ReceiptTrustControllerState {
  return {
    ...current,
    externalDirectory: undefined,
    externalDirectoryPolicy: undefined,
    externalDirectorySubscriptionId: undefined,
    directoryDiscovery: undefined,
    directoryVerification: undefined,
    directoryMetadataVerification: undefined,
    verification: undefined,
  };
}

export function clearBaselineActivationEvidenceState(
  current: ReceiptTrustControllerState,
): ReceiptTrustControllerState {
  return {
    ...current,
    baselineVerification: undefined,
    baselineImportResult: undefined,
    baselineActivationDecision: undefined,
    baselineActivationHistoryVerification: undefined,
    baselineActivationSelectionDriftAudit: undefined,
    baselineActivationRotationReview: undefined,
    baselineActivationRotationProposal: undefined,
    baselineActivationRotationProposalEnvelope: undefined,
    baselineActivationRotationProposalPreflight: undefined,
    baselineActivationSelectionCheckpoint: undefined,
    baselineActivationSelectionCheckpointEnvelope: undefined,
    baselineActivationSelectionCheckpointVerification: undefined,
    baselineActivationSelectionCheckpointDiscovery: undefined,
    checkpointRegistryQuorumBaselineVerification: undefined,
    checkpointRegistryQuorumBaselineImportResult: undefined,
  };
}

function upsertById<T extends { id: string; createdAt: string }>(
  current: T[],
  value: T,
): T[] {
  const next = current.filter((candidate) => candidate.id !== value.id);
  next.push(value);
  return next.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}
