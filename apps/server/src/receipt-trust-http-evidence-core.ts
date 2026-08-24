import { setOptionalHeader } from "./app-http-response-core.js";
import { setBodyContentSha256Header, setStableContentSha256Header, sha256Json } from "./http-response-evidence.js";
import type { ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult, ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult, PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult, PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult, ReceiptTrustAnchor, ReceiptTrustAnchorDirectory, ReceiptTrustAnchorDirectoryQuorum, ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory, ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification, ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit, ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview, ReceiptTrustAnchorDirectoryQuorumActivationSelectionState, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification, ReceiptTrustAnchorDirectoryQuorumPromotionBaseline, ReceiptTrustAnchorDirectoryQuorumPromotionReceipt, SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult } from "@napier/contracts";
import type { Context } from "hono";

export function setReceiptTrustAnchorListHeaders(context: Context, anchors: readonly ReceiptTrustAnchor[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, anchors);
  context.header("X-Napier-Receipt-Trust-Anchor-Count", String(anchors.length));
  context.header("X-Napier-Receipt-Trust-Trusted-Count", String(anchors.filter((anchor) => anchor.status === "trusted").length));
  context.header("X-Napier-Receipt-Trust-Revoked-Count", String(anchors.filter((anchor) => anchor.status === "revoked").length));
  context.header("X-Napier-Receipt-Trust-Signing-Capable-Count", String(anchors.filter((anchor) => Boolean(anchor.signingSource)).length));
}

export function setReceiptTrustAnchorDirectoryHeaders(context: Context, directory: ReceiptTrustAnchorDirectory): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, directory.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", directory.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", directory.anchorSetSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Count", String(directory.anchorCount));
  context.header("X-Napier-Receipt-Trust-Trusted-Count", String(directory.trustedCount));
  context.header("X-Napier-Receipt-Trust-Revoked-Count", String(directory.revokedCount));
}

export function setReceiptTrustAnchorDirectoryQuorumHeaders(context: Context, quorum: ReceiptTrustAnchorDirectoryQuorum): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, quorum.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-SHA256", quorum.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Status", quorum.status);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Policy-SHA256", quorum.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Source-Count", String(quorum.sourceCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Candidate-Count", String(quorum.candidateCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Count", String(quorum.agreementCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Weight", String(quorum.agreementWeight));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Distinct-Origin-Count", String(quorum.agreementDistinctSourceOriginCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Metadata-Publisher-Count", String(quorum.agreementMetadataPublisherCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Metadata-Publisher-Set-SHA256", quorum.agreementMetadataPublisherSetSha256);
  context.header("X-Napier-Diagnostic-Count", String(quorum.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(quorum.diagnostics));
  if (quorum.selectedAnchorSetSha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", quorum.selectedAnchorSetSha256);
  }
  if (quorum.selectedDirectorySha256) {
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", quorum.selectedDirectorySha256);
  }
}

export function setReceiptTrustAnchorDirectoryQuorumPromotionHeaders(context: Context, promotion: ReceiptTrustAnchorDirectoryQuorumPromotionReceipt): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, promotion.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256", promotion.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-SHA256", promotion.quorum.contentSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", promotion.selectedAnchorSetSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", promotion.selectedDirectorySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Selected-Subscription-Count", String(promotion.selectedSubscriptionCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Count", String(promotion.selectedMetadataCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Envelope-Set-SHA256", promotion.selectedMetadataEnvelopeSetSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumPromotionBaselineListHeaders(context: Context, baselines: readonly ReceiptTrustAnchorDirectoryQuorumPromotionBaseline[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Count", String(baselines.length));
  const current = baselines.at(-1);
  if (current) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", current.id);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", current.contentSha256);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256", current.envelope.receipt.contentSha256);
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

export function setPromoteReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(context: Context, result: PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Created", String(result.created));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256", result.baseline.envelope.receipt.contentSha256);
  context.header("X-Napier-Receipt-Artifact-SHA256", result.baseline.envelope.signature.receiptArtifactSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", result.baseline.selectedAnchorSetSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", result.baseline.selectedDirectorySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Selected-Subscription-Set-SHA256", result.baseline.selectedSubscriptionSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Selected-Metadata-Envelope-Set-SHA256", result.baseline.selectedMetadataEnvelopeSetSha256);
}

export function setImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResultHeaders(context: Context, result: ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Imported", String(result.imported));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Expected-Current-SHA256", result.expectedCurrentBaselineSha256);
  if (result.previousBaselineSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Previous-SHA256", result.previousBaselineSha256);
  }
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-SHA256", result.verification.contentSha256);
  if (result.policyReview) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-SHA256", result.policyReview.policySha256);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-Review-SHA256", result.policyReview.contentSha256);
  }
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-SHA256", result.baseline.envelope.receipt.contentSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationDecisionResultHeaders(context: Context, result: SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision", result.envelope.receipt.decision);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-SHA256", result.envelope.receipt.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Verification-SHA256", result.verification.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-SHA256", result.policyReview.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Import-Policy-Review-SHA256", result.policyReview.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-SHA256", result.sourceAlignment.contentSha256);
  context.header("X-Napier-Envelope-SHA256", result.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.envelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryHeaders(context: Context, history: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Count", String(history.decisionCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Approved-Count", String(history.approvedCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Rejected-Count", String(history.rejectedCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Distinct-Baseline-Count", String(history.distinctBaselineCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Set-SHA256", history.decisionSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Baseline-Set-SHA256", history.baselineSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Policy-Review-Set-SHA256", history.policyReviewSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-Set-SHA256", history.sourceAlignmentSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Latest-Decision-At", history.latestDecisionAt);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  setOptionalHeader(context, "X-Napier-Declared-Content-SHA256", verification.declaredContentSha256);
  setOptionalHeader(context, "X-Napier-Recomputed-Content-SHA256", verification.recomputedContentSha256);
  context.header("X-Napier-Current-Content-SHA256", verification.currentContentSha256);
  setOptionalHeader(context, "X-Napier-Declared-Decision-Set-SHA256", verification.declaredDecisionSetSha256);
  context.header("X-Napier-Current-Decision-Set-SHA256", verification.currentDecisionSetSha256);
  if (verification.declaredDecisionCount !== undefined) {
    context.header("X-Napier-Declared-Decision-Count", String(verification.declaredDecisionCount));
  }
  context.header("X-Napier-Current-Decision-Count", String(verification.currentDecisionCount));
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionStateHeaders(context: Context, state: ReceiptTrustAnchorDirectoryQuorumActivationSelectionState): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, state.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active", String(state.hasSelection));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", state.currentSelectionSha256);
  if (state.selection) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id", state.selection.id);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", state.selection.activationDecisionRecordId);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-Id", state.selection.baselineId);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", state.selection.baselineSha256);
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", state.selection.selectedAnchorSetSha256);
    context.header("X-Napier-Receipt-Trust-Anchor-Directory-SHA256", state.selection.selectedDirectorySha256);
  }
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAuditHeaders(context: Context, audit: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, audit.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status", audit.status);
  context.header("X-Napier-Diagnostic-Count", String(audit.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(audit.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active", String(audit.hasSelection));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-State-SHA256", audit.selectionStateSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id", audit.selectionId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", audit.selectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Anchor-Directory-Anchor-Set-SHA256", audit.selectedAnchorSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Anchor-Directory-SHA256", audit.selectedDirectorySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Status", audit.currentQuorumStatus);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-SHA256", audit.currentQuorumSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Source-Count", String(audit.currentSourceCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Count", String(audit.currentAgreementCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Agreement-Weight", String(audit.currentAgreementWeight));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Current-Anchor-Set-SHA256", audit.currentAnchorSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Current-Directory-SHA256", audit.currentDirectorySha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointHeaders(context: Context, checkpoint: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, checkpoint.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Active", String(checkpoint.hasSelection));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count", String(checkpoint.selectionCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", checkpoint.selectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", checkpoint.selectionChainTailSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", checkpoint.currentSelectionSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Id", checkpoint.currentSelectionId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Entry-SHA256", checkpoint.currentSelectionEntrySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Count", String(checkpoint.activationDecisionCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Set-SHA256", checkpoint.activationDecisionSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Baseline-Set-SHA256", checkpoint.baselineSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Policy-Review-Set-SHA256", checkpoint.policyReviewSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-Set-SHA256", checkpoint.sourceAlignmentSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Audit-SHA256", checkpoint.driftAuditSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status", checkpoint.driftStatus);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  setOptionalHeader(context, "X-Napier-Declared-Content-SHA256", verification.declaredContentSha256);
  setOptionalHeader(context, "X-Napier-Recomputed-Content-SHA256", verification.recomputedContentSha256);
  context.header("X-Napier-Current-Content-SHA256", verification.currentContentSha256);
  setOptionalHeader(context, "X-Napier-Declared-Selection-Set-SHA256", verification.declaredSelectionSetSha256);
  context.header("X-Napier-Current-Selection-Set-SHA256", verification.currentSelectionSetSha256);
  setOptionalHeader(context, "X-Napier-Declared-Selection-Chain-Tail-SHA256", verification.declaredSelectionChainTailSha256);
  setOptionalHeader(context, "X-Napier-Current-Selection-Chain-Tail-SHA256", verification.currentSelectionChainTailSha256);
  if (verification.declaredSelectionCount !== undefined) {
    context.header("X-Napier-Declared-Selection-Count", String(verification.declaredSelectionCount));
  }
  context.header("X-Napier-Current-Selection-Count", String(verification.currentSelectionCount));
  setOptionalHeader(context, "X-Napier-Declared-Selection-Current-SHA256", verification.declaredCurrentSelectionSha256);
  context.header("X-Napier-Current-Selection-SHA256", verification.currentSelectionSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryHeaders(context: Context, discovery: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, discovery.contentSha256);
  context.header("X-Napier-Discovery-Status", discovery.status);
  context.header("X-Napier-Diagnostic-Count", String(discovery.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(discovery.diagnostics));
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", discovery.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", discovery.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Discovery-Policy-SHA256", discovery.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Verification-SHA256", discovery.checkpointVerification.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Verification-Status", discovery.checkpointVerification.status);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", discovery.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", discovery.checkpointSha256);
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", discovery.signerKeyId);
  if (discovery.selectionCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count", String(discovery.selectionCount));
  }
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", discovery.selectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", discovery.selectionChainTailSha256);
  context.header("X-Napier-Current-Selection-Count", String(discovery.currentSelectionCount));
  setOptionalHeader(context, "X-Napier-Current-Selection-Chain-Tail-SHA256", discovery.currentSelectionChainTailSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionListHeaders(context: Context, subscriptions: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, subscriptions);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Count", String(subscriptions.length));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Set-SHA256", sha256Json(subscriptions.map((subscription) => subscription.contentSha256).sort()));
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumHeaders(context: Context, quorum: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, quorum.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Status", quorum.status);
  context.header("X-Napier-Diagnostic-Count", String(quorum.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(quorum.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Policy-SHA256", quorum.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Source-Count", String(quorum.sourceCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Eligible-Source-Count", String(quorum.eligibleSourceCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Stale-Source-Count", String(quorum.staleSourceCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Candidate-Count", String(quorum.candidateCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Agreement-Count", String(quorum.agreementCount));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Agreement-Distinct-Origin-Count", String(quorum.agreementDistinctSourceOriginCount));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", quorum.selectedCheckpointSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", quorum.selectedSelectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", quorum.selectedSelectionChainTailSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineListHeaders(context: Context, baselines: readonly ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, baselines);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Count", String(baselines.length));
  const current = baselines.at(-1);
  if (current) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id", current.id);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", current.contentSha256);
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256", current.envelope.receipt.contentSha256);
    context.header("X-Napier-Envelope-SHA256", current.envelope.contentSha256);
  }
}

export function setPromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(context: Context, result: PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Created", String(result.created));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256", result.baseline.envelope.receipt.contentSha256);
  context.header("X-Napier-Receipt-Artifact-SHA256", result.baseline.envelope.signature.receiptArtifactSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", result.baseline.selectedCheckpointSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", result.baseline.selectedSelectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", result.baseline.selectedSelectionChainTailSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Subscription-Set-SHA256", result.baseline.selectedSubscriptionSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Source-Origin-Set-SHA256", result.baseline.selectedSourceOriginSetSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Signer-Set-SHA256", result.baseline.selectedSignerSetSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerificationHeaders(context: Context, verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Valid", String(verification.baselineValid));
  context.header("X-Napier-Signature-Valid", String(verification.signatureValid));
  context.header("X-Napier-Integrity-Valid", String(verification.integrityValid));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", verification.baselineSha256);
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", verification.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256", verification.quorumSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Artifact-SHA256", verification.receiptArtifactSha256);
  setOptionalHeader(context, "X-Napier-Signature-Key-Id", verification.keyId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", verification.selectedCheckpointSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", verification.selectedSelectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", verification.selectedSelectionChainTailSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Anchor-Directory-SHA256", verification.anchorDirectorySha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Anchor-Directory-Verification-SHA256", verification.anchorDirectoryVerificationSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Anchor-Directory-Policy-SHA256", verification.anchorDirectoryPolicySha256);
}

export function setImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResultHeaders(context: Context, result: ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, result);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Imported", String(result.imported));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Expected-Current-SHA256", result.expectedCurrentBaselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Previous-SHA256", result.previousBaselineSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Id", result.baseline.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-SHA256", result.baseline.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Baseline-Verification-SHA256", result.verification.contentSha256);
  context.header("X-Napier-Envelope-SHA256", result.baseline.envelope.contentSha256);
  context.header("X-Napier-Signature-Key-Id", result.baseline.envelope.signature.keyId);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionHeaders(context: Context, subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, subscription.contentSha256);
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(context, subscription);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshHeaders(context: Context, result: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Refresh-SHA256", result.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Refresh-Status", result.status);
  if (result.discovery) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Discovery-SHA256", result.discovery.contentSha256);
  }
  if (result.failureSha256) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Failure-SHA256", result.failureSha256);
  }
  setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(context, result.subscription);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionEvidenceHeaders(context: Context, subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription): void {
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Id", subscription.id);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-SHA256", subscription.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Revision", String(subscription.revision));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Status", subscription.status);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-URL-SHA256", subscription.sourceUrlSha256);
  context.header("X-Napier-Receipt-Trust-Anchor-Directory-Source-Origin-SHA256", subscription.sourceOriginSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Policy-SHA256", subscription.policySha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Next-Refresh-At", subscription.nextRefreshAt);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Transparency-Entry-Count", String(subscription.transparencyEntryCount));
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Transparency-Tail-SHA256", subscription.transparencyTailSha256);
  if (subscription.lastRefreshStatus) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Subscription-Last-Refresh-Status", subscription.lastRefreshStatus);
  }
  setOptionalHeader(context, "X-Napier-Envelope-SHA256", subscription.lastGoodDiscovery?.envelopeSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-SHA256", subscription.lastGoodDiscovery?.checkpointSha256);
  if (subscription.lastGoodDiscovery?.selectionCount !== undefined) {
    context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Count", String(subscription.lastGoodDiscovery.selectionCount));
  }
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Set-SHA256", subscription.lastGoodDiscovery?.selectionSetSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Chain-Tail-SHA256", subscription.lastGoodDiscovery?.selectionChainTailSha256);
}

export function setReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewHeaders(context: Context, review: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Rotation-Review-Status", review.status);
  context.header("X-Napier-Diagnostic-Count", String(review.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(review.diagnostics));
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Expected-Current-SHA256", review.expectedCurrentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Current-SHA256", review.currentSelectionSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-Id", review.activationDecisionRecordId);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Decision-Record-SHA256", review.activationDecisionRecordSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Promotion-Baseline-SHA256", review.baselineSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Source-Alignment-SHA256", review.sourceAlignmentSha256);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Current-Source-Alignment-SHA256", review.currentSourceAlignmentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Audit-SHA256", review.driftAudit.contentSha256);
  context.header("X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Drift-Status", review.driftAudit.status);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-Status", review.checkpointRegistryQuorum?.status);
  setOptionalHeader(context, "X-Napier-Receipt-Trust-Directory-Quorum-Activation-Selection-Checkpoint-Registry-Quorum-SHA256", review.checkpointRegistryQuorum?.contentSha256);
}
