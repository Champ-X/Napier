import type { ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult } from "./receipt-trust-activation-v1.js";
import type { ReceiptTrustAnchorDirectoryVerificationPolicy, TrustedReceiptEnvelopeBase as TrustedReceiptEnvelope, TrustedReceiptVerificationStatus } from "./receipt-trust-core-v1.js";
import type { ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription } from "./receipt-trust-rotation-v1.js";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval";
  schemaVersion: 1;
  apiVersion: string;
  approvedAt: string;
  approvedByThreadId: string;
  subscriptionId: string;
  subscriptionRevision: number;
  subscriptionSha256: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  policySha256: string;
  discoverySha256: string;
  envelopeSha256: string;
  proposalSha256: string;
  proposalReviewSha256: string;
  approvalPreflightSha256: string;
  activationDecisionRecordId: string;
  expectedCurrentSelectionSha256: string;
  checkpointRegistryQuorumBaselineSha256?: string;
  proposalSignerKeyId: string;
  proposalSignedAt: string;
  expiresAt?: string;
  contentSha256: string;
}

export interface SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest {
  threadId: string;
  trustAnchorId: string;
  expectedSubscriptionRevision: number;
  expectedSubscriptionSha256: string;
  expectedDiscoverySha256?: string;
  expectedEnvelopeSha256?: string;
  expectedProposalSha256?: string;
  expiresAt?: string;
  queueForApply?: boolean;
  applyAfter?: string;
}

export interface ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalRequest {
  threadId: string;
  expectedSubscriptionRevision: number;
  expectedSubscriptionSha256: string;
  approvalEnvelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy {
  minimumDistinctSignerCount: number;
  requiredSignerKeyIds?: string[];
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewStatus = "accepted" | "rejected";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-review";
  schemaVersion: 1;
  apiVersion: string;
  reviewedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReviewStatus;
  diagnostics: string[];
  subscriptionId: string;
  subscriptionRevision: number;
  subscriptionSha256: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  subscriptionPolicySha256: string;
  expectedSubscriptionRevision: number;
  expectedSubscriptionSha256: string;
  approvalPolicy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy;
  approvalPolicySha256: string;
  approvalEnvelopeCount: number;
  acceptedApprovalCount: number;
  distinctSignerCount: number;
  requiredSignerCount: number;
  approvalEnvelopeSetSha256: string;
  acceptedApprovalEnvelopeSetSha256: string;
  signerSetSha256: string;
  requiredSignerSetSha256?: string;
  approvalEnvelopeSha256s: string[];
  acceptedApprovalEnvelopeSha256s: string[];
  acceptedApprovalSignerKeyIds: string[];
  activationDecisionRecordId?: string;
  expectedCurrentSelectionSha256?: string;
  proposalEnvelopeSha256?: string;
  proposalSha256?: string;
  proposalReviewSha256?: string;
  currentPreflightSha256?: string;
  checkpointRegistryQuorumBaselineSha256?: string;
  contentSha256: string;
}

export interface ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest {
  threadId: string;
  expectedSubscriptionRevision: number;
  expectedSubscriptionSha256: string;
  approvalEnvelopes: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApproval>[];
  approvalPolicy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicy;
}

export interface ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest extends ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest {}

export interface ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyResult {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-apply";
  schemaVersion: 1;
  apiVersion: string;
  appliedAt: string;
  policyReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview;
  policyReviewSha256: string;
  result: ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult;
  resultSha256: string;
  contentSha256: string;
}

export interface QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyRequest extends ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest {
  approvalPolicyBaselineSha256: string;
  applyAfter?: string;
}

export interface QueueReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyApplyResult {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-apply-queue";
  schemaVersion: 1;
  apiVersion: string;
  queuedAt: string;
  applyAfter: string;
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  subscriptionSha256: string;
  policyReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview;
  policyReviewSha256: string;
  approvalPolicyBaselineSha256: string;
  approvalPolicySha256: string;
  approvalEnvelopeSetSha256: string;
  acceptedApprovalEnvelopeSetSha256: string;
  signerSetSha256: string;
  contentSha256: string;
}

export interface PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest extends ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyRequest {
  trustAnchorId: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline {
  id: string;
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyReview>;
  promotedByThreadId: string;
  approvalPolicySha256: string;
  subscriptionSha256: string;
  proposalSha256?: string;
  acceptedApprovalEnvelopeSetSha256: string;
  signerSetSha256: string;
  requiredSignerSetSha256?: string;
  supersedesBaselineId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
  created: boolean;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest {
  baseline: unknown;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-policy-baseline-verification";
  schemaVersion: 1;
  apiVersion: string;
  verifiedAt: string;
  status: TrustedReceiptVerificationStatus;
  diagnostics: string[];
  baselineValid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  baselineSha256?: string;
  envelopeSha256?: string;
  policyReviewSha256?: string;
  receiptArtifactSha256?: string;
  keyId?: string;
  approvalPolicySha256?: string;
  subscriptionSha256?: string;
  acceptedApprovalEnvelopeSetSha256?: string;
  signerSetSha256?: string;
  requiredSignerSetSha256?: string;
  contentSha256: string;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest extends VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineRequest {
  threadId: string;
  expectedCurrentBaselineSha256: string;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaseline;
  imported: boolean;
  expectedCurrentBaselineSha256: string;
  verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalPolicyBaselineVerification;
  previousBaselineSha256?: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayStatus = "aligned" | "divergent" | "invalid";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplay {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-approval-apply-replay";
  schemaVersion: 1;
  apiVersion: string;
  replayedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionApprovalApplyReplayStatus;
  diagnostics: string[];
  subscriptionId: string;
  subscriptionRevision: number;
  subscriptionSha256: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  policySha256: string;
  expectedSubscriptionRevision: number;
  expectedSubscriptionSha256: string;
  currentSelectionSha256: string;
  selectionStateSha256: string;
  activeSelectionSha256?: string;
  activeActivationDecisionRecordId?: string;
  approvalVerifierSelectionSha256?: string;
  approvalVerifierDirectorySha256?: string;
  approvalEnvelopeSha256?: string;
  approvalSha256?: string;
  approvalTrustedReceiptVerificationStatus?: TrustedReceiptVerificationStatus;
  approvalTrustedReceiptVerificationReason?: string;
  approvalTrustedReceiptVerificationKeyId?: string;
  proposalEnvelopeSha256?: string;
  proposalSha256?: string;
  proposalReviewSha256?: string;
  approvalPreflightSha256?: string;
  activationDecisionRecordId?: string;
  expectedCurrentSelectionSha256?: string;
  checkpointRegistryQuorumBaselineSha256?: string;
  contentSha256: string;
}

