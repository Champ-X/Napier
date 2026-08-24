export interface ReceiptTrustAnchorDirectoryMetadataReceipt {
  kind: "napier.receipt-trust-anchor-directory-metadata-receipt";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  publisher: string;
  directorySha256: string;
  anchorSetSha256: string;
  anchorCount: number;
  trustedCount: number;
  revokedCount: number;
  sourceUrlSha256?: string;
  sourceOriginSha256?: string;
  expiresAt?: string;
  contentSha256: string;
}

export type TrustedReceiptKind =
  | "evaluation_gate"
  | "casebook_qualification"
  | "policy_retirement_proof_bundle"
  | "receipt_trust_anchor_directory_metadata"
  | "receipt_trust_anchor_directory_quorum_promotion"
  | "receipt_trust_anchor_directory_quorum_activation_decision"
  | "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal"
  | "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval"
  | "receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal_subscription_approval_policy_review"
  | "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint"
  | "receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum";

export type ReceiptTrustAnchorStatus = "trusted" | "revoked";

export type CreateReceiptTrustAnchorSource =
  | {
      type: "environment";
      variable: string;
    }
  | {
      type: "public_key";
      publicKeySpki: string;
    };

export interface ReceiptTrustAnchor {
  id: string;
  label: string;
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  signingSource?: {
    type: "environment";
    variable: string;
  };
  status: ReceiptTrustAnchorStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryEntry {
  id: string;
  label: string;
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpki: string;
  status: ReceiptTrustAnchorStatus;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  anchorSha256: string;
}

export interface ReceiptTrustAnchorDirectory {
  kind: "napier.receipt-trust-anchor-directory";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  receiptKinds: TrustedReceiptKind[];
  anchorCount: number;
  trustedCount: number;
  revokedCount: number;
  anchorSetSha256: string;
  anchors: ReceiptTrustAnchorDirectoryEntry[];
  contentSha256: string;
}

export interface CreateReceiptTrustAnchorRequest {
  threadId: string;
  label: string;
  source: CreateReceiptTrustAnchorSource;
}

export interface RevokeReceiptTrustAnchorRequest {
  threadId: string;
}

export interface TrustedReceiptSignature {
  algorithm: "Ed25519";
  keyId: string;
  signedAt: string;
  receiptArtifactSha256: string;
  statementSha256: string;
  value: string;
}

export interface TrustedReceiptPayload {
  kind: string;
  schemaVersion: number;
  contentSha256: string;
}

export interface TrustedReceiptEnvelopeBase<Receipt extends TrustedReceiptPayload = TrustedReceiptPayload> {
  kind: "napier.trusted-receipt-envelope";
  schemaVersion: 1;
  apiVersion: string;
  receiptKind: TrustedReceiptKind;
  receipt: Receipt;
  signature: TrustedReceiptSignature;
  contentSha256: string;
}

export type TrustedReceiptVerificationStatus = "trusted" | "revoked" | "unknown_key" | "invalid";

export type TrustedReceiptAnchorDirectorySource = "uploaded" | "active_selection";

export interface TrustedReceiptVerification {
  status: TrustedReceiptVerificationStatus;
  verifiedAt: string;
  receiptKind?: TrustedReceiptKind;
  receiptContentSha256?: string;
  receiptArtifactSha256?: string;
  keyId?: string;
  envelopeSha256?: string;
  anchorDirectorySha256?: string;
  anchorDirectoryVerificationSha256?: string;
  anchorDirectoryPolicySha256?: string;
  anchorDirectoryGeneratedAt?: string;
  anchorDirectoryAgeMs?: number;
  anchorDirectoryAnchorCount?: number;
  anchorDirectorySource?: TrustedReceiptAnchorDirectorySource;
  anchorDirectorySelectionId?: string;
  anchorDirectorySelectionSha256?: string;
  anchorDirectorySelectionStateSha256?: string;
  signatureValid: boolean;
  integrityValid: boolean;
  reason: string;
}

export interface SignTrustedReceiptRequest {
  trustAnchorId: string;
  threadId?: string;
}

export interface SignReceiptTrustAnchorDirectoryMetadataRequest extends SignTrustedReceiptRequest {
  threadId: string;
  publisher: string;
  sourceUrlSha256?: string;
  sourceOriginSha256?: string;
  expiresAt?: string;
}

export interface VerifyTrustedReceiptRequest {
  envelope: unknown;
  directory?: unknown;
  directoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface VerifyReceiptTrustAnchorDirectoryMetadataRequest {
  envelope: unknown;
  directory: unknown;
  directoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface VerifyReceiptTrustAnchorDirectoryRequest {
  directory: unknown;
  policy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface DiscoverReceiptTrustAnchorDirectoryRequest {
  sourceUrl: string;
  policy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface ReceiptTrustAnchorDirectoryVerificationPolicy {
  maxAgeMs?: number;
  expectedAnchorSetSha256?: string;
  minimumTrustedCount?: number;
  requiredTrustedKeyIds?: string[];
}

export type ReceiptTrustAnchorDirectoryVerificationStatus = "valid" | "invalid";

export interface ReceiptTrustAnchorDirectoryVerification {
  kind: "napier.receipt-trust-anchor-directory-verification";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryVerificationStatus;
  diagnostics: string[];
  policy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
  policySha256?: string;
  directoryGeneratedAt?: string;
  directoryAgeMs?: number;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  declaredAnchorSetSha256?: string;
  recomputedAnchorSetSha256?: string;
  anchorCount?: number;
  trustedCount?: number;
  revokedCount?: number;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryMetadataVerification {
  kind: "napier.receipt-trust-anchor-directory-metadata-verification";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: TrustedReceiptVerificationStatus;
  diagnostics: string[];
  trustedReceiptVerification: TrustedReceiptVerification;
  directoryVerification: ReceiptTrustAnchorDirectoryVerification;
  trustDirectoryVerification?: ReceiptTrustAnchorDirectoryVerification;
  metadata?: ReceiptTrustAnchorDirectoryMetadataReceipt;
  publisher?: string;
  directorySha256?: string;
  anchorSetSha256?: string;
  signerKeyId?: string;
  envelopeSha256?: string;
  signatureValid: boolean;
  integrityValid: boolean;
  directoryBindingValid: boolean;
  expiresAt?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryDiscovery {
  kind: "napier.receipt-trust-anchor-directory-discovery";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryVerificationStatus;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  httpStatus: number;
  responseMediaType: string;
  responseBytes: number;
  responseBodySha256: string;
  verification: ReceiptTrustAnchorDirectoryVerification;
  directory?: ReceiptTrustAnchorDirectory;
  contentSha256: string;
}

export type ReceiptTrustAnchorDirectorySubscriptionStatus = "active" | "paused";

export type ReceiptTrustAnchorDirectorySubscriptionRefreshStatus = "promoted" | "unchanged" | "rollback_rejected" | "rejected" | "failed";

export type ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus = "promoted" | "unchanged";

export interface ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry {
  kind: "napier.receipt-trust-anchor-directory-subscription-transparency-entry";
  schemaVersion: 1;
  apiVersion: string;
  sequence: number;
  status: ReceiptTrustAnchorDirectorySubscriptionTransparencyStatus;
  observedAt: string;
  discoverySha256: string;
  directorySha256: string;
  anchorSetSha256: string;
  trustedCount: number;
  previousEntrySha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectorySubscription {
  kind: "napier.receipt-trust-anchor-directory-subscription";
  schemaVersion: 1;
  apiVersion: string;
  id: string;
  auditThreadId: string;
  label: string;
  status: ReceiptTrustAnchorDirectorySubscriptionStatus;
  revision: number;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  refreshIntervalMs: number;
  nextRefreshAt: string;
  policy: ReceiptTrustAnchorDirectoryVerificationPolicy;
  policySha256: string;
  lastRefreshAt?: string;
  lastRefreshStatus?: ReceiptTrustAnchorDirectorySubscriptionRefreshStatus;
  lastDiscoverySha256?: string;
  lastFailureSha256?: string;
  lastGoodDiscovery?: ReceiptTrustAnchorDirectoryDiscovery;
  transparencyEntryCount: number;
  transparencyTailSha256?: string;
  transparencyHistory: ReceiptTrustAnchorDirectorySubscriptionTransparencyEntry[];
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

export interface CreateReceiptTrustAnchorDirectorySubscriptionRequest {
  threadId: string;
  label: string;
  sourceUrl: string;
  refreshIntervalMs: number;
  policy: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface RefreshReceiptTrustAnchorDirectorySubscriptionRequest {
  threadId: string;
  expectedRevision: number;
}

export interface UpdateReceiptTrustAnchorDirectorySubscriptionRequest {
  threadId: string;
  expectedRevision: number;
  status: ReceiptTrustAnchorDirectorySubscriptionStatus;
}

export interface ReceiptTrustAnchorDirectorySubscriptionRefreshResult {
  kind: "napier.receipt-trust-anchor-directory-subscription-refresh";
  schemaVersion: 1;
  apiVersion: string;
  status: ReceiptTrustAnchorDirectorySubscriptionRefreshStatus;
  subscription: ReceiptTrustAnchorDirectorySubscription;
  discovery?: ReceiptTrustAnchorDirectoryDiscovery;
  failureSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumSourceWeight {
  sourceOriginSha256: string;
  weight: number;
}

export interface ReceiptTrustAnchorDirectoryQuorumPolicy {
  minimumSources?: number;
  minimumAgreementCount?: number;
  minimumDistinctSourceOrigins?: number;
  minimumAgreementWeight?: number;
  minimumMetadataPublisherCount?: number;
  expectedAnchorSetSha256?: string;
  requiredSourceOriginSha256s?: string[];
  requiredMetadataPublisherSha256s?: string[];
  sourceWeights?: ReceiptTrustAnchorDirectoryQuorumSourceWeight[];
}
