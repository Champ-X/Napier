import type { ReceiptTrustAnchorDirectory, ReceiptTrustAnchorDirectoryVerificationPolicy, SignTrustedReceiptRequest, TrustedReceiptEnvelopeBase as TrustedReceiptEnvelope, TrustedReceiptVerification, TrustedReceiptVerificationStatus } from "./receipt-trust-core-v1.js";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus = "missing_selection" | "aligned" | "directory_drift" | "anchor_set_drift" | "quorum_unavailable";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelection {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection";
  schemaVersion: 1;
  apiVersion: string;
  id: string;
  activatedAt: string;
  activatedByThreadId: string;
  activationDecisionRecordId: string;
  activationDecisionRecordSha256: string;
  activationDecisionReceiptSha256: string;
  activationDecisionEnvelopeSha256: string;
  baselineId: string;
  baselineSha256: string;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  selectedDirectory: ReceiptTrustAnchorDirectory;
  policyReviewSha256: string;
  sourceAlignmentSha256: string;
  previousSelectionSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionState {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-state";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  hasSelection: boolean;
  currentSelectionSha256: string;
  selection?: ReceiptTrustAnchorDirectoryQuorumActivationSelection;
  contentSha256: string;
}

export interface ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionRequest {
  threadId: string;
  activationDecisionRecordId: string;
  expectedCurrentSelectionSha256: string;
  rotationProposalEnvelope?: TrustedReceiptEnvelope;
}

export interface ApplyReceiptTrustAnchorDirectoryQuorumActivationSelectionResult {
  applied: boolean;
  expectedCurrentSelectionSha256: string;
  selection: ReceiptTrustAnchorDirectoryQuorumActivationSelection;
  selectionState: ReceiptTrustAnchorDirectoryQuorumActivationSelectionState;
  previousSelectionSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-entry";
  schemaVersion: 1;
  apiVersion: string;
  sequence: number;
  activatedAt: string;
  activatedByThreadId: string;
  selectionId: string;
  selectionSha256: string;
  activationDecisionRecordId: string;
  activationDecisionRecordSha256: string;
  activationDecisionReceiptSha256: string;
  activationDecisionEnvelopeSha256: string;
  baselineId: string;
  baselineSha256: string;
  selectedAnchorSetSha256: string;
  selectedDirectorySha256: string;
  policyReviewSha256: string;
  sourceAlignmentSha256: string;
  previousSelectionSha256?: string;
  previousEntrySha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  hasSelection: boolean;
  selectionCount: number;
  currentSelectionSha256: string;
  currentSelectionId?: string;
  currentSelectionEntrySha256?: string;
  selectionSetSha256: string;
  selectionChainTailSha256?: string;
  activationDecisionCount: number;
  activationDecisionSetSha256: string;
  baselineSetSha256: string;
  policyReviewSetSha256: string;
  sourceAlignmentSetSha256: string;
  driftAuditSha256: string;
  driftStatus: ReceiptTrustAnchorDirectoryQuorumActivationSelectionDriftStatus;
  entries: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyEntry[];
  contentSha256: string;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest {
  checkpoint: unknown;
}

export interface SignReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest extends SignTrustedReceiptRequest {
  threadId: string;
  trustAnchorId: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy {
  maxEnvelopeAgeMs?: number;
  expectedCheckpointSha256?: string;
  expectedSelectionSetSha256?: string;
  expectedSelectionChainTailSha256?: string;
  minimumSelectionCount?: number;
  requiredSignerKeyIds?: string[];
  rejectRollback?: boolean;
}

export interface DiscoverReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRequest {
  sourceUrl: string;
  policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationStatus = "valid" | "divergent" | "invalid";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-verification";
  schemaVersion: 1;
  apiVersion: string;
  verifiedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerificationStatus;
  diagnostics: string[];
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  currentContentSha256: string;
  declaredSelectionSetSha256?: string;
  currentSelectionSetSha256: string;
  declaredSelectionChainTailSha256?: string;
  currentSelectionChainTailSha256?: string;
  declaredSelectionCount?: number;
  currentSelectionCount: number;
  declaredCurrentSelectionSha256?: string;
  currentSelectionSha256: string;
  contentSha256: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryStatus = "valid" | "invalid";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-discovery";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryStatus;
  diagnostics: string[];
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  httpStatus: number;
  responseMediaType: string;
  responseBytes: number;
  responseBodySha256: string;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy;
  policySha256: string;
  trustedReceiptVerification: TrustedReceiptVerification;
  checkpointVerification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointVerification;
  envelopeSha256?: string;
  checkpointSha256?: string;
  signerKeyId?: string;
  signedAt?: string;
  selectionCount?: number;
  selectionSetSha256?: string;
  selectionChainTailSha256?: string;
  currentSelectionCount: number;
  currentSelectionChainTailSha256?: string;
  envelope?: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpoint>;
  contentSha256: string;
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus = "active" | "paused";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus = "accepted" | "unchanged" | "rollback_rejected" | "rejected" | "failed";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyStatus = "accepted" | "unchanged";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription-transparency-entry";
  schemaVersion: 1;
  apiVersion: string;
  sequence: number;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyStatus;
  observedAt: string;
  discoverySha256: string;
  envelopeSha256: string;
  checkpointSha256: string;
  selectionCount: number;
  selectionSetSha256: string;
  selectionChainTailSha256?: string;
  previousEntrySha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription";
  schemaVersion: 1;
  apiVersion: string;
  id: string;
  auditThreadId: string;
  label: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus;
  revision: number;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  refreshIntervalMs: number;
  nextRefreshAt: string;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy;
  policySha256: string;
  lastRefreshAt?: string;
  lastRefreshStatus?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus;
  lastDiscoverySha256?: string;
  lastFailureSha256?: string;
  lastGoodDiscovery?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
  transparencyEntryCount: number;
  transparencyTailSha256?: string;
  transparencyHistory: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionTransparencyEntry[];
  createdAt: string;
  updatedAt: string;
  contentSha256: string;
}

export interface CreateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest {
  threadId: string;
  label: string;
  sourceUrl: string;
  refreshIntervalMs: number;
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscoveryPolicy;
}

export interface RefreshReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest {
  threadId: string;
  expectedRevision: number;
}

export interface UpdateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRequest {
  threadId: string;
  expectedRevision: number;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionStatus;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshResult {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-subscription-refresh";
  schemaVersion: 1;
  apiVersion: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscriptionRefreshStatus;
  subscription: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointSubscription;
  discovery?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointDiscovery;
  failureSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy {
  minimumSources?: number;
  minimumAgreementCount?: number;
  minimumDistinctSourceOrigins?: number;
  maxObservationAgeMs?: number;
  expectedCheckpointSha256?: string;
  expectedSelectionSetSha256?: string;
  expectedSelectionChainTailSha256?: string;
  minimumSelectionCount?: number;
  requiredSourceOriginSha256s?: string[];
  requiredSignerKeyIds?: string[];
}

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumStatus = "agreed" | "insufficient_sources" | "split" | "policy_failed" | "stale";

export type ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySourceStatus = "eligible" | "paused" | "missing_last_good" | "stale";

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource {
  subscriptionId: string;
  subscriptionSha256: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySourceStatus;
  diagnostics: string[];
  revision: number;
  observedAt?: string;
  discoverySha256?: string;
  envelopeSha256?: string;
  checkpointSha256?: string;
  signerKeyId?: string;
  selectionCount?: number;
  selectionSetSha256?: string;
  selectionChainTailSha256?: string;
  transparencyTailSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate {
  checkpointSha256: string;
  sourceCount: number;
  distinctSourceOriginCount: number;
  signerCount: number;
  subscriptionSetSha256: string;
  sourceOriginSetSha256: string;
  signerSetSha256: string;
  selectionCount: number;
  selectionSetSha256: string;
  selectionChainTailSha256?: string;
  contentSha256: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum";
  schemaVersion: 1;
  apiVersion: string;
  generatedAt: string;
  status: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumStatus;
  diagnostics: string[];
  policy: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy;
  policySha256: string;
  sourceCount: number;
  eligibleSourceCount: number;
  staleSourceCount: number;
  candidateCount: number;
  agreementCount: number;
  agreementDistinctSourceOriginCount: number;
  agreementSignerCount: number;
  selectedCheckpointSha256?: string;
  selectedSelectionSetSha256?: string;
  selectedSelectionChainTailSha256?: string;
  sources: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistrySource[];
  candidates: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryCandidate[];
  contentSha256: string;
}

export interface EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest {
  policy?: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumPolicy;
}

export interface PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest extends EvaluateReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumRequest {
  threadId: string;
  trustAnchorId: string;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline {
  id: string;
  envelope: TrustedReceiptEnvelope<ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorum>;
  promotedByThreadId: string;
  selectedCheckpointSha256: string;
  selectedSelectionSetSha256: string;
  selectedSelectionChainTailSha256?: string;
  selectedSubscriptionSetSha256: string;
  selectedSourceOriginSetSha256: string;
  selectedSignerSetSha256: string;
  supersedesBaselineId?: string;
  createdAt: string;
  contentSha256: string;
}

export interface PromoteReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  created: boolean;
}

export interface VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest {
  baseline: unknown;
  trustDirectory?: unknown;
  trustDirectoryPolicy?: ReceiptTrustAnchorDirectoryVerificationPolicy;
}

export interface ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification {
  kind: "napier.receipt-trust-anchor-directory-quorum-activation-selection-transparency-checkpoint-registry-quorum-baseline-verification";
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
  quorumSha256?: string;
  receiptArtifactSha256?: string;
  keyId?: string;
  selectedCheckpointSha256?: string;
  selectedSelectionSetSha256?: string;
  selectedSelectionChainTailSha256?: string;
  selectedSubscriptionSetSha256?: string;
  selectedSourceOriginSetSha256?: string;
  selectedSignerSetSha256?: string;
  anchorDirectorySha256?: string;
  anchorDirectoryVerificationSha256?: string;
  anchorDirectoryPolicySha256?: string;
  contentSha256: string;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest extends VerifyReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineRequest {
  threadId: string;
  expectedCurrentBaselineSha256: string;
}

export interface ImportReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineResult {
  baseline: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaseline;
  imported: boolean;
  verification: ReceiptTrustAnchorDirectoryQuorumActivationSelectionTransparencyCheckpointRegistryQuorumBaselineVerification;
  expectedCurrentBaselineSha256: string;
  previousBaselineSha256?: string;
}
