import type { ReceiptTrustAnchorDirectory, ReceiptTrustAnchorDirectoryMetadataReceipt, ReceiptTrustAnchorDirectoryQuorumPolicy, ReceiptTrustAnchorDirectoryVerificationPolicy, SignTrustedReceiptRequest, TrustedReceiptEnvelopeBase as TrustedReceiptEnvelope, TrustedReceiptVerificationStatus } from "./receipt-trust-core-v1.js";

export interface EvaluateReceiptTrustAnchorDirectoryQuorumRequest {
  policy?: ReceiptTrustAnchorDirectoryQuorumPolicy;
  metadata?: ReceiptTrustAnchorDirectoryQuorumMetadataInput[];
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export type PromoteReceiptTrustAnchorDirectoryQuorumRequest = EvaluateReceiptTrustAnchorDirectoryQuorumRequest;

export interface PromoteReceiptTrustAnchorDirectoryQuorumBaselineRequest extends EvaluateReceiptTrustAnchorDirectoryQuorumRequest {
  threadId: string;
  trustAnchorId: string;
}

export type ReceiptTrustAnchorDirectoryQuorumStatus = "agreed" | "insufficient_sources" | "split" | "policy_failed";

export interface ReceiptTrustAnchorDirectoryQuorumMetadataInput {
  subscriptionId: string;
  envelope: unknown;
}

export interface ReceiptTrustAnchorDirectoryQuorumSourceMetadata {
  status: TrustedReceiptVerificationStatus;
  signatureValid: boolean;
  integrityValid: boolean;
  directoryBindingValid: boolean;
  diagnosticCount: number;
  diagnosticsSha256: string;
  publisherSha256?: string;
  signerKeyId?: string;
  envelopeSha256?: string;
  verificationSha256?: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumMetadataEvidence extends ReceiptTrustAnchorDirectoryQuorumSourceMetadata {
  subscriptionId: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumSource {
  subscriptionId: string;
  subscriptionSha256: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  weight: number;
  metadata?: ReceiptTrustAnchorDirectoryQuorumSourceMetadata;
  revision: number;
  directorySha256: string;
  anchorSetSha256: string;
  discoverySha256: string;
  transparencyTailSha256: string;
  trustedCount: number;
  observedAt: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumCandidate {
  anchorSetSha256: string;
  sourceCount: number;
  distinctSourceOriginCount: number;
  weight: number;
  metadataPublisherCount: number;
  metadataPublisherSetSha256: string;
  trustedCount: number;
  subscriptionSetSha256: string;
  directorySetSha256: string;
  discoverySetSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorum {
  kind: "napier.receipt-trust-anchor-directory-quorum";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumStatus;
  diagnostics: string[];
  policy: Required<ReceiptTrustAnchorDirectoryQuorumPolicy>;
  policySha256: string;
  sourceCount: number;
  candidateCount: number;
  agreementCount: number;
  agreementWeight: number;
  agreementDistinctSourceOriginCount: number;
  agreementMetadataPublisherCount: number;
  agreementMetadataPublisherSetSha256: string;
  selectedAnchorSetSha256?: string;
  selectedDirectorySha256?: string;
  selectedDirectory?: ReceiptTrustAnchorDirectory;
  sources: ReceiptTrustAnchorDirectoryQuorumSource[];
  candidates: ReceiptTrustAnchorDirectoryQuorumCandidate[];
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionMetadata {
  subscriptionId: string;
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryMetadataReceipt>;
  envelopeSha256: string;
  verificationSha256: string;
  publisherSha256?: string;
  signerKeyId?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionReceipt {
  kind: "napier.receipt-trust-anchor-directory-quorum-promotion";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  quorum: ReceiptTrustAnchorDirectoryQuorum;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  selectedSubscriptionCount: number;
  selectedSubscriptionSetSha256: string;
  selectedMetadataCount: number;
  selectedMetadataEnvelopeSetSha256: string;
  selectedMetadata: ReceiptTrustAnchorDirectoryQuorumPromotionMetadata[];
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionBaseline {
  id: string;
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumPromotionReceipt>;
  promotedByThreadId: string;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  selectedSubscriptionSetSha256: string;
  selectedMetadataEnvelopeSetSha256: string;
  supersedesBaselineId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface PromoteReceiptTrustAnchorDirectoryQuorumBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  created: boolean;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest {
  baseline: unknown;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest extends VerifyReceiptTrustAnchorDirectoryQuorumPromotionBaselineRequest {
  threadId: string;
  expectedCurrentBaselineSha256: string;
  importPolicy?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy;
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy {
  maxBaselineAgeMs?: number;
  maxReceiptAgeMs?: number;
  maxSourceObservedAgeMs?: number;
  minimumAgreementCount?: number;
  minimumAgreementWeight?: number;
  minimumDistinctSourceOrigins?: number;
  minimumMetadataPublisherCount?: number;
  minimumSelectedMetadataCount?: number;
  expectedAnchorSetSha256?: string;
  expectedDirectorySha256?: string;
  requiredSourceOriginSha256s?: string[];
  requiredMetadataPublisherSha256s?: string[];
  requiredMetadataSignerKeyIds?: string[];
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyProjection {
  maxBaselineAgeMs: number;
  maxReceiptAgeMs: number;
  maxSourceObservedAgeMs: number;
  minimumAgreementCount: number;
  minimumAgreementWeight: number;
  minimumDistinctSourceOrigins: number;
  minimumMetadataPublisherCount: number;
  minimumSelectedMetadataCount: number;
  expectedAnchorSetSha256: string;
  expectedDirectorySha256: string;
  requiredSourceOriginSha256s: string[];
  requiredMetadataPublisherSha256s: string[];
  requiredMetadataSignerKeyIds: string[];
}

export type ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReviewStatus = "accepted" | "rejected";

export interface ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview {
  kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-import-policy-review";
  schemaVersion: 1;
  apiVersion: string;
  reviewedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReviewStatus;
  diagnostics: string[];
  policy: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyProjection;
  policySha256: string;
  baselineSha256?: string;
  envelopeSha256?: string;
  receiptSha256?: string;
  keyId?: string;
  selectedAnchorSetSha256?: string;
  selectedDirectorySha256?: string;
  selectedSourceOriginCount?: number;
  selectedSourceOriginSetSha256?: string;
  selectedMetadataPublisherCount?: number;
  selectedMetadataPublisherSetSha256?: string;
  selectedMetadataSignerCount?: number;
  selectedMetadataSignerSetSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification {
  kind: "napier.receipt-trust-anchor-directory-quorum-promotion-baseline-verification";
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
  receiptSha256?: string;
  receiptArtifactSha256?: string;
  keyId?: string;
  selectedAnchorSetSha256?: string;
  selectedDirectorySha256?: string;
  selectedSubscriptionSetSha256?: string;
  selectedMetadataEnvelopeSetSha256?: string;
  anchorDirectorySha256?: string;
  anchorDirectoryVerificationSha256?: string;
  anchorDirectoryPolicySha256?: string;
  contentSha256: string;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumPromotionBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  imported: boolean;
  verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
  policyReview?: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
  expectedCurrentBaselineSha256: string;
  previousBaselineSha256?: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSourceStatus = "aligned" | "directory_drift" | "anchor_set_drift" | "no_last_good" | "missing_subscription";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSource {
  sourceOriginSha256: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSourceStatus;
  subscriptionId?: string;
  subscriptionSha256?: string;
  currentAnchorSetSha256?: string;
  currentDirectorySha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-source-alignment";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  baselineSha256: string;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  selectedSourceOriginCount: number;
  selectedSourceOriginSetSha256: string;
  alignedSourceCount: number;
  driftedSourceCount: number;
  missingSourceCount: number;
  sources: ReceiptTrustAnchorDirectoryQuorumActivationSource[];
  contentSha256: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationDecisionStatus = "approved" | "rejected";

export interface ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  decision: ReceiptTrustAnchorDirectoryQuorumActivationDecisionStatus;
  diagnostics: string[];
  baselineId: string;
  baselineSha256: string;
  envelopeSha256: string;
  receiptSha256: string;
  receiptArtifactSha256: string;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  verificationStatus: TrustedReceiptVerificationStatus;
  verificationSha256: string;
  signatureValid: boolean;
  integrityValid: boolean;
  policyReviewStatus: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReviewStatus;
  policySha256: string;
  policyReviewSha256: string;
  sourceAlignmentSha256: string;
  alignedSourceCount: number;
  driftedSourceCount: number;
  missingSourceCount: number;
  selectedSourceOriginSetSha256: string;
  metadataPublisherSetSha256: string;
  metadataSignerSetSha256: string;
  contentSha256: string;
}

export interface SignReceiptTrustAnchorDirectoryQuorumActivationDecisionRequest extends SignTrustedReceiptRequest {
  threadId: string;
  trustAnchorId: string;
  baselineId?: string;
  importPolicy: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicy;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumPromotionBaseline;
  verification: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineVerification;
  policyReview: ReceiptTrustAnchorDirectoryQuorumPromotionBaselineImportPolicyReview;
  sourceAlignment: ReceiptTrustAnchorDirectoryQuorumActivationSourceAlignment;
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationDecisionReceipt>;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord extends SignReceiptTrustAnchorDirectoryQuorumActivationDecisionResult {
  id: string;
  signedByThreadId: string;
  createdAt: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistory {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  decisionCount: number;
  approvedCount: number;
  rejectedCount: number;
  distinctBaselineCount: number;
  decisionSetSha256: string;
  baselineSetSha256: string;
  policyReviewSetSha256: string;
  sourceAlignmentSetSha256: string;
  latestDecisionAt?: string;
  records: ReceiptTrustAnchorDirectoryQuorumActivationDecisionRecord[];
  contentSha256: string;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryRequest {
  history: unknown;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationStatus = "valid" | "divergent" | "invalid";

export interface ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerification {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-decision-history-verification";
  schemaVersion: 1;
  apiVersion: string;
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationDecisionHistoryVerificationStatus;
  diagnostics: string[];
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  currentContentSha256: string;
  declaredDecisionSetSha256?: string;
  currentDecisionSetSha256: string;
  declaredDecisionCount?: number;
  currentDecisionCount: number;
  contentSha256: string;
}
