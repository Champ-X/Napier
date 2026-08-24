import type {
  ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum,
  ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  ReceiptTrustAnchorDirectoryQuorumPromotionReceipt,
  SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
  TrustedReceiptEnvelope,
} from "@napier/contracts";
import {
  createReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline,
  createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline,
  createReceiptTrustAnchorDirectoryQuorumPromotionBaseline,
  MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS,
  MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES,
} from "./receipt-trust-directory-subscriptions.js";
import type { StoreRepositoryState } from "./store-repository-host.js";

export function appendReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
  state: StoreRepositoryState,
  threadId: string,
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>,
): ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
  if (
    state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.length >=
    MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum promotion exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_PROMOTION_BASELINES} baselines`,
    );
  }
  const current =
    state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.at(-1);
  const baseline = createReceiptTrustAnchorDirectoryQuorumPromotionBaseline(
    envelope,
    threadId,
    current?.id,
  );
  state.receiptTrustAnchorDirectoryQuorumPromotionBaselines.push(baseline);
  return baseline;
}

export function appendReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
  state: StoreRepositoryState,
  threadId: string,
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline {
  const baselines =
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselines;
  if (baselines.length >= MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES) {
    throw new Error(
      `Receipt trust checkpoint registry quorum exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES} baselines`,
    );
  }
  const baseline =
    createReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline(
      envelope,
      threadId,
      baselines.at(-1)?.id,
    );
  baselines.push(baseline);
  return baseline;
}

export function appendReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
  state: StoreRepositoryState,
  threadId: string,
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>,
): ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline {
  const baselines =
    state.receiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselines;
  if (baselines.length >= MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES) {
    throw new Error(
      `Receipt trust rotation approval policy exceeds ${MAX_RECEIPT_TRUST_CHECKPOINT_REGISTRY_QUORUM_BASELINES} baselines`,
    );
  }
  const baseline =
    createReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline(
      threadId,
      envelope,
      baselines.at(-1)?.id,
    );
  baselines.push(baseline);
  return baseline;
}

export function appendReceiptTrustAnchorDirectoryQuorumActivationDecision(
  state: StoreRepositoryState,
  threadId: string,
  result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult,
): ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord {
  if (
    state.receiptTrustAnchorDirectoryQuorumActivationDecisions.length >=
    MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS
  ) {
    throw new Error(
      `Receipt trust anchor directory quorum activation exceeds ${MAX_RECEIPT_TRUST_DIRECTORY_QUORUM_ACTIVATION_DECISIONS} decisions`,
    );
  }
  const record = createReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord({
    signedByThreadId: threadId,
    baseline: result.baseline,
    verification: result.verification,
    policyReview: result.policyReview,
    sourceAlignment: result.sourceAlignment,
    envelope: result.envelope,
  });
  state.receiptTrustAnchorDirectoryQuorumActivationDecisions.push(record);
  return record;
}
