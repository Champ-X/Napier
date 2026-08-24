import type { ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest, ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline, ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy } from "./receipt-trust-activation-v1.js";
import type { TrustedReceiptEnvelopeBase as TrustedReceiptEnvelope, TrustedReceiptVerificationStatus } from "./receipt-trust-core-v1.js";
import type { ReceiptTrustAnchorDirectoryQuorumStatus } from "./receipt-trust-quorum-v1.js";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-drift-audit";
  schemaVersion: 1;
  apiVersion: string;
  auditedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus;
  diagnostics: string[];
  hasSelection: boolean;
  selectionStateSha256: string;
  selectionId?: string;
  selectionSha256?: string;
  selectedAnchorSetSha256?: string;
  selectedDirectorySha256?: string;
  currentQuorumStatus: ReceiptTrustAnchorDirectoryQuorumStatus;
  currentQuorumSha256: string;
  currentSourceCount: number;
  currentAgreementCount: number;
  currentAgreementWeight: number;
  currentAnchorSetSha256?: string;
  currentDirectorySha256?: string;
  contentSha256: string;
}

export interface ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest {
  activationDecisionRecordId: string;
  expectedCurrentSelectionSha256: string;
  checkpointRegistryQuorumPolicy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewStatus = "eligible" | "already_active" | "blocked" | "stale_selection" | "missing_decision";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-review";
  schemaVersion: 1;
  apiVersion: string;
  reviewedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReviewStatus;
  diagnostics: string[];
  expectedCurrentSelectionSha256: string;
  currentSelectionSha256: string;
  activationDecisionRecordId: string;
  activationDecisionRecordSha256?: string;
  baselineSha256?: string;
  sourceAlignmentSha256?: string;
  currentSourceAlignmentSha256?: string;
  driftAudit: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftAudit;
  checkpointRegistryQuorum?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum;
  contentSha256: string;
}

export interface ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest extends ReviewReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest {
  checkpointRegistryQuorumBaselineId?: string;
  expectedCheckpointRegistryQuorumBaselineSha256?: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalStatus = "proposed" | "blocked" | "stale_selection" | "missing_decision" | "already_active" | "missing_checkpoint_registry_baseline";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal";
  schemaVersion: 1;
  apiVersion: string;
  proposedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalStatus;
  diagnostics: string[];
  activationDecisionRecordId: string;
  activationDecisionRecordSha256?: string;
  expectedCurrentSelectionSha256: string;
  currentSelectionSha256: string;
  rotationReview: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationReview;
  rotationReviewSha256: string;
  checkpointRegistryQuorumBaselineId?: string;
  expectedCheckpointRegistryQuorumBaselineSha256?: string;
  checkpointRegistryQuorumBaselineSha256?: string;
  checkpointRegistryQuorumBaselineEnvelopeSha256?: string;
  checkpointRegistryQuorumSha256?: string;
  selectedCheckpointSha256?: string;
  selectedSelectionSetSha256?: string;
  selectedSelectionChainTailSha256?: string;
  selectedSubscriptionSetSha256?: string;
  selectedSourceOriginSetSha256?: string;
  selectedSignerSetSha256?: string;
  currentCheckpointSha256: string;
  currentSelectionSetSha256: string;
  currentSelectionChainTailSha256?: string;
  checkpointRegistryQuorumBaseline?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  contentSha256: string;
}

export interface SignReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest extends ProposeReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationRequest {
  threadId: string;
  trustAnchorId: string;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest extends ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest {}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightStatus = "accepted" | "rejected" | "not_required";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-preflight";
  schemaVersion: 1;
  apiVersion: string;
  checkedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflightStatus;
  diagnostics: string[];
  reason?: string;
  activationDecisionRecordId: string;
  expectedCurrentSelectionSha256: string;
  currentSelectionSha256: string;
  activeSelectionSha256?: string;
  rotationProposalEnvelopeSha256?: string;
  rotationProposalSha256?: string;
  rotationProposalReviewSha256?: string;
  rotationProposalCheckpointRegistryQuorumBaselineSha256?: string;
  trustedReceiptVerificationStatus?: TrustedReceiptVerificationStatus;
  trustedReceiptVerificationReason?: string;
  trustedReceiptVerificationKeyId?: string;
  trustedReceiptVerificationEnvelopeSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy {
  maxEnvelopeAgeMs?: number;
  expectedEnvelopeSha256?: string;
  expectedProposalSha256?: string;
  expectedActivationDecisionRecordId?: string;
  expectedCurrentSelectionSha256?: string;
  requiredSignerKeyIds?: string[];
}

export interface DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalRequest {
  threadId: string;
  sourceUrl: string;
  policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryStatus = "valid" | "invalid";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-discovery";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryStatus;
  diagnostics: string[];
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  httpStatus: number;
  responseMediaType: string;
  responseBytes: number;
  responseBodySha256: string;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy;
  policySha256: string;
  preflight?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalPreflight;
  envelopeSha256?: string;
  proposalSha256?: string;
  proposalReviewSha256?: string;
  checkpointRegistryQuorumBaselineSha256?: string;
  activationDecisionRecordId?: string;
  expectedCurrentSelectionSha256?: string;
  signerKeyId?: string;
  signedAt?: string;
  envelope?: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposal>;
  contentSha256: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus = "active" | "paused";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus = "accepted" | "unchanged" | "rollback_rejected" | "rejected" | "failed";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyStatus = "accepted" | "unchanged";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-transparency-entry";
  schemaVersion: 1;
  apiVersion: string;
  sequence: number;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyStatus;
  observedAt: string;
  discoverySha256: string;
  envelopeSha256: string;
  proposalSha256: string;
  preflightSha256: string;
  previousEntrySha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription";
  schemaVersion: 1;
  apiVersion: string;
  id: string;
  auditThreadId: string;
  label: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus;
  revision: number;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  refreshIntervalMs: number;
  nextRefreshAt: string;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy;
  policySha256: string;
  lastRefreshAt?: string;
  lastRefreshStatus?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus;
  lastDiscoverySha256?: string;
  lastFailureSha256?: string;
  lastGoodDiscovery?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
  transparencyEntryCount: number;
  transparencyTailSha256?: string;
  transparencyHistory: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionTransparencyEntry[];
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

export interface CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest {
  threadId: string;
  label: string;
  sourceUrl: string;
  refreshIntervalMs: number;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscoveryPolicy;
}

export interface RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest {
  threadId: string;
  expectedRevision: number;
}

export interface UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRequest {
  threadId: string;
  expectedRevision: number;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionStatus;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshResult {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-rotation-proposal-subscription-refresh";
  schemaVersion: 1;
  apiVersion: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscriptionRefreshStatus;
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalSubscription;
  discovery?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionRotationProposalDiscovery;
  failureSha256?: string;
  contentSha256: string;
}
