import type { ModelRef } from "./execution-core.js";

export type InboundChannelStatus = "active" | "disabled";
export type InboundChannelAdapter =
  | "napier_json"
  | "github_webhook"
  | "slack_event"
  | "linear_webhook";
export type InboundDeliveryStatus =
  | "accepted"
  | "running"
  | "retrying"
  | "completed"
  | "failed";

export interface InboundRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface InboundSignaturePolicy {
  required: boolean;
  algorithm: "hmac-sha256";
  header: "X-Napier-Channel-Signature";
  timestampHeader: "X-Napier-Channel-Timestamp";
  toleranceSeconds: number;
}

export type InboundChannelPolicyTemplateId =
  | "legacy_bearer"
  | "signed_standard"
  | "signed_strict"
  | "custom";

export interface InboundChannel {
  id: string;
  type: "webhook";
  adapter: InboundChannelAdapter;
  name: string;
  threadId: string;
  status: InboundChannelStatus;
  tokenFingerprint: string;
  policyTemplate: InboundChannelPolicyTemplateId;
  signaturePolicy: InboundSignaturePolicy;
  retryPolicy: InboundRetryPolicy;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedInboundChannel {
  channel: InboundChannel;
  token: string;
}

export interface CreateInboundChannelRequest {
  name: string;
  threadId: string;
  adapter?: InboundChannelAdapter;
  policyTemplate?: InboundChannelPolicyTemplateId;
  retryPolicy?: InboundRetryPolicy;
  signaturePolicy?: {
    required: boolean;
    toleranceSeconds?: number;
  };
}

export interface SetInboundChannelStatusRequest {
  status: InboundChannelStatus;
}

export interface UpdateInboundRetryPolicyRequest {
  retryPolicy: InboundRetryPolicy;
}

export interface UpdateInboundSignaturePolicyRequest {
  signaturePolicy: {
    required: boolean;
    toleranceSeconds?: number;
  };
}

export interface InboundChannelAdapterDescriptor {
  id: InboundChannelAdapter;
  label: string;
  description: string;
  idempotencySource: string;
  requiredHeaders: string[];
  sampleHeaders: Record<string, string>;
  sampleBody: string;
  securityNote: string;
}

export interface PreviewInboundChannelAdapterRequest {
  body: string;
  headers?: Record<string, string>;
}

export interface InboundChannelAdapterPreview {
  channelId: string;
  adapter: InboundChannelAdapter;
  bodySha256: string;
  idempotencyFingerprint: string;
  messageSha256: string;
  messagePreview: string;
  model?: ModelRef;
  contentSha256: string;
}

export interface InboundMessageRequest {
  idempotencyKey: string;
  message: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  model?: ModelRef;
}

export interface InboundDelivery {
  id: string;
  channelId: string;
  threadId: string;
  idempotencyFingerprint: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  status: InboundDeliveryStatus;
  triggerId: string;
  attemptCount: number;
  maxAttempts: number;
  retryBaseMs: number;
  runId?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  finishedAt?: string;
  revision: number;
}

export interface InboundReceipt {
  delivery: InboundDelivery;
  duplicate: boolean;
}

export type InboundDeliveryQualificationStatus =
  | "qualified"
  | "evidence_missing"
  | "adapter_catalog_drift";

export interface InboundDeliveryQualification {
  schemaVersion: 1;
  channelId: string;
  deliveryId: string;
  status: InboundDeliveryQualificationStatus;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  currentAdapterCatalogSha256: string;
  diagnostics: string[];
  contentSha256: string;
}

export type InboundDeadLetterRetryDisposition =
  | "manual_retry_available"
  | "retry_exhausted";

export interface InboundDeadLetter {
  deliveryId: string;
  threadId: string;
  idempotencyFingerprint: string;
  triggerId: string;
  attemptCount: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryDisposition: InboundDeadLetterRetryDisposition;
  qualificationStatus?: InboundDeliveryQualificationStatus;
  messageSha256: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  error: string;
  runId?: string;
  createdAt: string;
  lastAttemptAt?: string;
  finishedAt?: string;
}

export interface InboundDeadLetterExport {
  schemaVersion: 1;
  exportedAt: string;
  channel: {
    id: string;
    name: string;
    threadId: string;
    status: InboundChannelStatus;
    retryPolicy: InboundRetryPolicy;
    revision: number;
  };
  currentAdapterCatalogSha256?: string;
  qualifiedCount?: number;
  evidenceMissingCount?: number;
  adapterCatalogDriftCount?: number;
  deliveryCount: number;
  deliveries: InboundDeadLetter[];
  contentSha256: string;
}

export interface VerifyInboundDeadLetterExportRequest {
  artifact: unknown;
}

export type InboundDeadLetterExportVerificationStatus = "valid" | "invalid";

export interface InboundDeadLetterExportVerification {
  schemaVersion: 1;
  status: InboundDeadLetterExportVerificationStatus;
  diagnostics: string[];
  channelId?: string;
  expectedChannelId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  deliveryCount?: number;
  observedDeliveryCount?: number;
  qualifiedCount?: number;
  observedQualifiedCount?: number;
  evidenceMissingCount?: number;
  observedEvidenceMissingCount?: number;
  adapterCatalogDriftCount?: number;
  observedAdapterCatalogDriftCount?: number;
  contentSha256: string;
}

export interface PreviewInboundDeadLetterRetryRequest {
  artifact: unknown;
}

export interface ApplyInboundDeadLetterRetryRequest {
  artifact: unknown;
  expectedPreviewSha256: string;
  confirmReplay: boolean;
}

export type InboundDeadLetterRetryCandidateStatus =
  | "retryable"
  | "artifact_invalid"
  | "not_found"
  | "not_failed"
  | "retry_exhausted"
  | "state_changed";

export interface InboundDeadLetterRetryCandidate {
  deliveryId: string;
  status: InboundDeadLetterRetryCandidateStatus;
  diagnostics: string[];
  idempotencyFingerprint?: string;
  attemptCount?: number;
  maxAttempts?: number;
  bodySha256?: string;
  adapterCatalogSha256?: string;
}

export interface InboundDeadLetterRetryPreview {
  schemaVersion: 1;
  channelId: string;
  verificationStatus: InboundDeadLetterExportVerificationStatus;
  artifactSha256?: string;
  retryableCount: number;
  blockedCount: number;
  candidateSetSha256: string;
  retryableDeliveryIdsSha256: string;
  blockedDeliveryIdsSha256: string;
  diagnostics: string[];
  candidates: InboundDeadLetterRetryCandidate[];
  contentSha256: string;
}

export interface InboundDeadLetterRetryApplyResult {
  schemaVersion: 1;
  channelId: string;
  previewSha256: string;
  artifactSha256?: string;
  previewCandidateSetSha256: string;
  previewRetryableDeliveryIdsSha256: string;
  previewBlockedDeliveryIdsSha256: string;
  retriedCount: number;
  skippedCount: number;
  retriedDeliveryIdsSha256: string;
  skippedDeliveryIdsSha256: string;
  deliveries: InboundDelivery[];
  skipped: InboundDeadLetterRetryCandidate[];
  contentSha256: string;
}

export interface InboundDeadLetterRetryAuditRecord {
  eventId: string;
  seq: number;
  createdAt: string;
  channelId: string;
  applyResultSha256?: string;
  previewSha256: string;
  artifactSha256?: string;
  previewCandidateSetSha256: string;
  previewRetryableDeliveryIdsSha256: string;
  previewBlockedDeliveryIdsSha256: string;
  retriedCount: number;
  skippedCount: number;
  retriedDeliveryIdsSha256: string;
  skippedDeliveryIdsSha256: string;
}

export interface InboundDeadLetterRetryHistory {
  schemaVersion: 1;
  channelId: string;
  eventCount: number;
  fromSeq?: number;
  toSeq?: number;
  eventSetSha256: string;
  records: InboundDeadLetterRetryAuditRecord[];
  contentSha256: string;
}

export interface VerifyInboundDeadLetterRetryHistoryRequest {
  history: unknown;
}

export type InboundDeadLetterRetryHistoryVerificationStatus =
  | "valid"
  | "invalid";

export interface InboundDeadLetterRetryHistoryVerification {
  schemaVersion: 1;
  status: InboundDeadLetterRetryHistoryVerificationStatus;
  diagnostics: string[];
  channelId?: string;
  expectedChannelId?: string;
  declaredContentSha256?: string;
  recomputedContentSha256?: string;
  observedContentSha256?: string;
  declaredEventSetSha256?: string;
  observedEventSetSha256?: string;
  eventCount?: number;
  observedEventCount?: number;
  fromSeq?: number;
  observedFromSeq?: number;
  toSeq?: number;
  observedToSeq?: number;
  contentSha256: string;
}
