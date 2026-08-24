import { setOptionalHeader } from "./app-http-response-core.js";
import { setBodyContentSha256Header, setStableContentSha256Header, sha256Json, sha256Text } from "./http-response-evidence.js";
import type { RotationProposalSubscriptionApprovalApplyGateResult } from "./receipt-trust-rotation-proposals.js";
import type { ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult, ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult, ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult, PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult, QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult, ReceiptTrustAnchor, ReceiptTrustAnchorDirectoryDiscovery, ReceiptTrustAnchorDirectoryMetadataVerification, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult, ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification, ReceiptTrustAnchorDirectorySubscription, ReceiptTrustAnchorDirectorySubscriptionRefreshResult, ReceiptTrustAnchorDirectoryVerification } from "@napier/contracts";
import type { Context } from "hono";

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalHeaders(context: Context, proposal: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, proposal.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Status", proposal.status);
  context.header("X-Napier-Diagnostic-Count", String(proposal.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(proposal.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256", proposal.rotationReviewSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", proposal.expectedCurrentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", proposal.currentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", proposal.activationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256", proposal.activationDecisionRecordSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id", proposal.checkpointRegistryQuorumBaselineId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", proposal.checkpointRegistryQuorumBaselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Expected-SHA256", proposal.expectedCheckpointRegistryQuorumBaselineSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", proposal.checkpointRegistryQuorumBaselineEnvelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256", proposal.checkpointRegistryQuorumSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", proposal.currentCheckpointSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", proposal.currentSelectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", proposal.currentSelectionChainTailSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightHeaders(context: Context, preflight: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preflight.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-Status", preflight.status);
  context.header("X-Napier-Diagnostic-Count", String(preflight.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(preflight.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", preflight.expectedCurrentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", preflight.currentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", preflight.activationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active-SHA256", preflight.activeSelectionSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", preflight.rotationProposalEnvelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", preflight.rotationProposalSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256", preflight.rotationProposalReviewSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", preflight.rotationProposalCheckpointRegistryQuorumBaselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Verification-Status", preflight.trustedReceiptVerificationStatus);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Key-Id", preflight.trustedReceiptVerificationKeyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryHeaders(context: Context, discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header("X-Napier-Discovery-Status", discovery.status);
  context.header("X-Napier-Diagnostic-Count", String(discovery.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(discovery.diagnostics));
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", discovery.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", discovery.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Discovery-Policy-SHA256", discovery.policySha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Response-SHA256", discovery.responseBodySha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Response-Bytes", String(discovery.responseBytes));
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", discovery.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", discovery.proposalSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-SHA256", discovery.proposalReviewSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", discovery.checkpointRegistryQuorumBaselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", discovery.activationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", discovery.expectedCurrentSelectionSha256);
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", discovery.signerKeyId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-Status", discovery.preflight?.status);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-SHA256", discovery.preflight?.contentSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionListHeaders(context: Context, subscriptions: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Count", String(subscriptions.length));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Set-SHA256", sha256Json(subscriptions.map((subscription) => subscription.contentSha256).sort()));
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionHeaders(context: Context, subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(context, subscription);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshHeaders(context: Context, result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Refresh-SHA256", result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Refresh-Status", result.status);
  if (result.discovery) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Discovery-SHA256", result.discovery.contentSha256);
  }
  if (result.failureSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Failure-SHA256", result.failureSha256);
  }
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(context, result.subscription);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionEvidenceHeaders(context: Context, subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription): void {
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id", subscription.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256", subscription.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision", String(subscription.revision));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Status", subscription.status);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", subscription.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", subscription.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Policy-SHA256", subscription.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Next-Refresh-At", subscription.nextRefreshAt);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Transparency-Entry-Count", String(subscription.transparencyEntryCount));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Transparency-Tail-SHA256", subscription.transparencyTailSha256);
  if (subscription.lastRefreshStatus) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Last-Refresh-Status", subscription.lastRefreshStatus);
  }
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", subscription.lastGoodDiscovery?.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", subscription.lastGoodDiscovery?.proposalSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Preflight-SHA256", subscription.lastGoodDiscovery?.preflight?.contentSha256);
}

export function setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(context: Context, result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Applied", String(result.applied));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", result.expectedCurrentSelectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Previous-SHA256", result.previousSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", result.selection.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256", result.selectionState.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id", result.selection.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", result.selection.activationDecisionRecordId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", result.selection.baselineId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", result.selection.baselineSha256);
}

export function setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionApprovalResultHeaders(context: Context, result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult, approvalGate: Extract<RotationProposalSubscriptionApprovalApplyGateResult, { status: "accepted" }>): void {
  setApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResultHeaders(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-SHA256", approvalGate.approvalEnvelope.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-SHA256", approvalGate.approval.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Preflight-SHA256", approvalGate.approval.approvalPreflightSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Current-Preflight-SHA256", approvalGate.preflight.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id", approvalGate.approval.subscriptionId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256", approvalGate.approval.subscriptionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision", String(approvalGate.approval.subscriptionRevision));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", approvalGate.proposal.contentSha256);
  context.header("X-Napier-Envelope-SHA256", approvalGate.proposalEnvelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", approvalGate.approvalEnvelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewHeaders(context: Context, review: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header("X-Napier-Verification-Status", review.status);
  context.header("X-Napier-Diagnostic-Count", String(review.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(review.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id", review.subscriptionId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision", String(review.subscriptionRevision));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256", review.subscriptionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256", review.approvalPolicySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Minimum-Distinct-Signer-Count", String(review.approvalPolicy.minimumDistinctSignerCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-Count", String(review.approvalEnvelopeCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Accepted-Count", String(review.acceptedApprovalCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Distinct-Signer-Count", String(review.distinctSignerCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256", review.signerSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-Set-SHA256", review.approvalEnvelopeSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Accepted-Envelope-Set-SHA256", review.acceptedApprovalEnvelopeSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Required-Signer-Set-SHA256", review.requiredSignerSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", review.activationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", review.expectedCurrentSelectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", review.proposalSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", review.proposalEnvelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Current-Preflight-SHA256", review.currentPreflightSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(context: Context, applyResult: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, applyResult.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Applied", String(applyResult.result.applied));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256", applyResult.policyReviewSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-Result-SHA256", applyResult.resultSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", applyResult.result.selection.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256", applyResult.result.selectionState.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", applyResult.result.selection.activationDecisionRecordId);
  context.header("X-Napier-Verification-Status", applyResult.policyReview.status);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Distinct-Signer-Count", String(applyResult.policyReview.distinctSignerCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256", applyResult.policyReview.signerSetSha256);
}

export function setQueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResultHeaders(context: Context, queueResult: QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, queueResult.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-Queued-At", queueResult.queuedAt);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Apply-After", queueResult.applyAfter);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256", queueResult.approvalPolicyBaselineSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256", queueResult.policyReviewSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256", queueResult.approvalPolicySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256", queueResult.subscriptionSha256);
  context.header("X-Napier-Verification-Status", queueResult.policyReview.status);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineListHeaders(context: Context, baselines: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Count", String(baselines.length));
  const current = baselines.at(-1);
  if (current) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id", current.id);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256", current.contentSha256);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256", current.envelope.receipt.contentSha256);
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

export function setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(context: Context, result: PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Created", String(result.created));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256", result.baseline.approvalPolicySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256", result.baseline.signerSetSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Valid", String(verification.baselineValid));
  context.header("X-Napier-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Integrity-Valid", String(verification.integrityValid));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256", verification.baselineSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", verification.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Review-SHA256", verification.policyReviewSha256);
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", verification.keyId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-SHA256", verification.approvalPolicySha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Signer-Set-SHA256", verification.signerSetSha256);
}

export function setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResultHeaders(context: Context, result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Imported", String(result.imported));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Expected-Current-SHA256", result.expectedCurrentBaselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Previous-SHA256", result.previousBaselineSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Policy-Baseline-Verification-SHA256", result.verification.contentSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayHeaders(context: Context, replay: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, replay.contentSha256);
  context.header("X-Napier-Verification-Status", replay.status);
  context.header("X-Napier-Diagnostic-Count", String(replay.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(replay.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Id", replay.subscriptionId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-Revision", String(replay.subscriptionRevision));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Subscription-SHA256", replay.subscriptionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", replay.currentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256", replay.selectionStateSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active-SHA256", replay.activeSelectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", replay.activeActivationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verifier-Selection-SHA256", replay.approvalVerifierSelectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verifier-Directory-SHA256", replay.approvalVerifierDirectorySha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Envelope-SHA256", replay.approvalEnvelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-SHA256", replay.approvalSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-Approval-Verification-Status", replay.approvalTrustedReceiptVerificationStatus);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Proposal-SHA256", replay.proposalSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", replay.proposalEnvelopeSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-Status", verification.status);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Valid", String(verification.baselineValid));
  context.header("X-Napier-Receipt-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Receipt-Integrity-Valid", String(verification.integrityValid));
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  if (verification.baselineSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", verification.baselineSha256);
  }
  if (verification.receiptSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256", verification.receiptSha256);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.keyId) {
    context.header("X-Napier-Signature-Key-Id", verification.keyId);
  }
  if (verification.anchorDirectoryVerificationSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256", verification.anchorDirectoryVerificationSha256);
  }
}

export function setReceiptTrustAnchorDirectorySubscriptionListHeaders(context: Context, subscriptions: ReceiptTrustAnchorDirectorySubscription[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Count", String(subscriptions.length));
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Active-Count", String(subscriptions.filter((subscription) => subscription.status === "active").length));
}

export function setReceiptTrustAnchorDirectorySubscriptionHeaders(context: Context, subscription: ReceiptTrustAnchorDirectorySubscription): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(context, subscription);
}

export function setReceiptTrustAnchorDirectorySubscriptionRefreshHeaders(context: Context, result: ReceiptTrustAnchorDirectorySubscriptionRefreshResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Refresh-SHA256", result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Refresh-Status", result.status);
  if (result.discovery) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Discovery-SHA256", result.discovery.contentSha256);
  }
  if (result.failureSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Subscription-Failure-SHA256", result.failureSha256);
  }
  setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(context, result.subscription);
}

export function setReceiptTrustAnchorDirectorySubscriptionEvidenceHeaders(context: Context, subscription: ReceiptTrustAnchorDirectorySubscription): void {
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Id", subscription.id);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-SHA256", subscription.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Revision", String(subscription.revision));
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Status", subscription.status);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", subscription.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", subscription.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256", subscription.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Next-Refresh-At", subscription.nextRefreshAt);
  context.header("X-Napier-Receipt-Trust-Directory-Subscription-Transparency-Entry-Count", String(subscription.transparencyEntryCount));
  if (subscription.transparencyTailSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Subscription-Transparency-Tail-SHA256", subscription.transparencyTailSha256);
  }
  if (subscription.lastRefreshStatus) {
    context.header("X-Napier-Receipt-Trust-Directory-Subscription-Last-Refresh-Status", subscription.lastRefreshStatus);
  }
  if (subscription.lastGoodDiscovery?.directory) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", subscription.lastGoodDiscovery.directory.contentSha256);
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", subscription.lastGoodDiscovery.directory.anchorSetSha256);
  }
}

export function setReceiptTrustAnchorDirectoryDiscoveryHeaders(context: Context, discovery: ReceiptTrustAnchorDirectoryDiscovery): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Discovery-SHA256", discovery.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", discovery.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", discovery.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Response-SHA256", discovery.responseBodySha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Response-Bytes", String(discovery.responseBytes));
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-HTTP-Status", String(discovery.httpStatus));
  context.header("X-Napier-Verification-Status", discovery.status);
  context.header("X-Napier-Diagnostic-Count", String(discovery.verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(discovery.verification.diagnostics));
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256", discovery.verification.contentSha256);
  if (discovery.verification.policySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256", discovery.verification.policySha256);
  }
  if (discovery.verification.directoryAgeMs !== undefined) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms", String(discovery.verification.directoryAgeMs));
  }
  if (discovery.directory) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", discovery.directory.contentSha256);
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", discovery.directory.anchorSetSha256);
    context.header("X-Napier-Receipt-Trust-Anchor-Count", String(discovery.directory.anchorCount));
  }
}

export function setReceiptTrustAnchorDirectoryVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  if (verification.declaredContentSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", verification.declaredContentSha256);
  }
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256", verification.contentSha256);
  if (verification.policySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256", verification.policySha256);
  }
  if (verification.directoryGeneratedAt) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Generated-At", verification.directoryGeneratedAt);
  }
  if (verification.directoryAgeMs !== undefined) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Age-Ms", String(verification.directoryAgeMs));
  }
  if (verification.declaredAnchorSetSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", verification.declaredAnchorSetSha256);
  }
  if (verification.recomputedAnchorSetSha256) {
    context.header("X-Napier-Recomputed-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", verification.recomputedAnchorSetSha256);
  }
  if (verification.anchorCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Anchor-Count", String(verification.anchorCount));
  }
  if (verification.trustedCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Trusted-Count", String(verification.trustedCount));
  }
  if (verification.revokedCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Revoked-Count", String(verification.revokedCount));
  }
}

export function setReceiptTrustAnchorDirectoryMetadataVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryMetadataVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Metadata-Verification-SHA256", verification.contentSha256);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  context.header("X-Napier-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Integrity-Valid", String(verification.integrityValid));
  context.header("X-Napier-Directory-Binding-Valid", String(verification.directoryBindingValid));
  if (verification.publisher) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Publisher-SHA256", sha256Text(verification.publisher));
  }
  if (verification.signerKeyId) {
    context.header("X-Napier-Signature-Key-Id", verification.signerKeyId);
  }
  if (verification.envelopeSha256) {
    context.header("X-Napier-Envelope-SHA256", verification.envelopeSha256);
  }
  if (verification.directorySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", verification.directorySha256);
  }
  if (verification.anchorSetSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", verification.anchorSetSha256);
  }
  if (verification.expiresAt) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Metadata-Expires-At", verification.expiresAt);
  }
}

export function setReceiptTrustAnchorHeaders(context: Context, anchor: ReceiptTrustAnchor): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, anchor.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Id", anchor.id);
  context.header("X-Napier-Signature-Key-Id", anchor.keyId);
  context.header("X-Napier-Receipt-Trust-Anchor-Status", anchor.status);
  context.header("X-Napier-Receipt-Trust-Signing-Capable", String(Boolean(anchor.signingSource)));
}
