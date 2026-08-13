import type { RunEvent } from "@napier/contracts";

export interface ChannelEventTraceView {
  action: string;
  type?: string;
  adapter?: string;
  status?: string;
  source?: string;
  policyTemplate?: string;
  signatureAlgorithm?: string;
  channelId?: string;
  deliveryId?: string;
  runId?: string;
  revision?: number;
  channelRevision?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  previousMaxAttempts?: number;
  previousBaseDelayMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  attempt?: number;
  attemptCount?: number;
  schemaVersion?: number;
  deliveryCount?: number;
  qualifiedCount?: number;
  evidenceMissingCount?: number;
  adapterCatalogDriftCount?: number;
  retriedCount?: number;
  skippedCount?: number;
  previousToleranceSeconds?: number;
  toleranceSeconds?: number;
  signatureRequired?: boolean;
  previousRequired?: boolean;
  required?: boolean;
  tokenFingerprint?: string;
  previousTokenFingerprint?: string;
  idempotencyFingerprint?: string;
  nextAttemptAt?: string;
  bodySha256?: string;
  adapterCatalogSha256?: string;
  contentSha256?: string;
  currentAdapterCatalogSha256?: string;
  applyResultSha256?: string;
  previewSha256?: string;
  artifactSha256?: string;
  previewCandidateSetSha256?: string;
  previewRetryableDeliveryIdsSha256?: string;
  previewBlockedDeliveryIdsSha256?: string;
  retriedDeliveryIdsSha256?: string;
  skippedDeliveryIdsSha256?: string;
}

const CHANNEL_EVENT =
  /^channel\.(created|enabled|disabled|retry_policy\.updated|signature_policy\.updated|token\.rotated|dead_letters\.(exported|retry_applied)|delivery\.(accepted|retry\.requested|deduplicated|started|completed|failed|retry\.(scheduled|exhausted)))$/u;
const SAFE_TOKEN = /^[A-Za-z0-9_.:/@-]{1,180}$/u;
const FINGERPRINT = /^[A-Za-z0-9_-]{4,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/u;
const CHANNEL_RECEIPT_SUMMARY = "channel receipt";

export function channelEventTraceView(
  event: RunEvent,
): ChannelEventTraceView | undefined {
  if (!CHANNEL_EVENT.test(event.type)) return undefined;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  return {
    action: event.type.slice("channel.".length),
    ...safeTokenField(event.payload, "type"),
    ...safeTokenField(event.payload, "adapter"),
    ...safeTokenField(event.payload, "status"),
    ...safeTokenField(event.payload, "source"),
    ...safeTokenField(event.payload, "policyTemplate"),
    ...safeTokenField(event.payload, "signatureAlgorithm"),
    ...safeTokenField(event.payload, "channelId"),
    ...safeTokenField(event.payload, "deliveryId"),
    ...safeTokenField(event.payload, "runId"),
    ...integerField(event.payload, "revision"),
    ...integerField(event.payload, "channelRevision"),
    ...integerField(event.payload, "retryMaxAttempts"),
    ...integerField(event.payload, "retryBaseDelayMs"),
    ...integerField(event.payload, "previousMaxAttempts"),
    ...integerField(event.payload, "previousBaseDelayMs"),
    ...integerField(event.payload, "maxAttempts"),
    ...integerField(event.payload, "retryBaseMs"),
    ...integerField(event.payload, "attempt"),
    ...integerField(event.payload, "attemptCount"),
    ...integerField(event.payload, "schemaVersion"),
    ...integerField(event.payload, "deliveryCount"),
    ...integerField(event.payload, "qualifiedCount"),
    ...integerField(event.payload, "evidenceMissingCount"),
    ...integerField(event.payload, "adapterCatalogDriftCount"),
    ...integerField(event.payload, "retriedCount"),
    ...integerField(event.payload, "skippedCount"),
    ...integerField(event.payload, "previousToleranceSeconds"),
    ...integerField(event.payload, "toleranceSeconds"),
    ...booleanField(event.payload, "signatureRequired"),
    ...booleanField(event.payload, "previousRequired"),
    ...booleanField(event.payload, "required"),
    ...fingerprintField(event.payload, "tokenFingerprint"),
    ...fingerprintField(event.payload, "previousTokenFingerprint"),
    ...fingerprintField(event.payload, "idempotencyFingerprint"),
    ...safeIsoField(event.payload, "nextAttemptAt"),
    ...shaField(event.payload, "bodySha256"),
    ...shaField(event.payload, "adapterCatalogSha256"),
    ...shaField(event.payload, "contentSha256"),
    ...shaField(event.payload, "currentAdapterCatalogSha256"),
    ...shaField(event.payload, "applyResultSha256"),
    ...shaField(event.payload, "previewSha256"),
    ...shaField(event.payload, "artifactSha256"),
    ...shaField(event.payload, "previewCandidateSetSha256"),
    ...shaField(event.payload, "previewRetryableDeliveryIdsSha256"),
    ...shaField(event.payload, "previewBlockedDeliveryIdsSha256"),
    ...shaField(event.payload, "retriedDeliveryIdsSha256"),
    ...shaField(event.payload, "skippedDeliveryIdsSha256"),
  };
}

export function channelEventTraceSummary(event: RunEvent): string | undefined {
  if (!event.type.startsWith("channel.")) return undefined;
  if (!CHANNEL_EVENT.test(event.type)) return event.category;
  const view = channelEventTraceView(event);
  if (!view) return CHANNEL_RECEIPT_SUMMARY;
  return [
    `channel / ${view.action}`,
    ...idSummary("channel", view.channelId),
    ...idSummary("delivery", view.deliveryId),
    ...idSummary("run", view.runId),
    ...(view.type ? [`type ${view.type}`] : []),
    ...(view.adapter ? [`adapter ${view.adapter}`] : []),
    ...(view.status ? [`status ${view.status}`] : []),
    ...(view.source ? [`source ${view.source}`] : []),
    ...(view.policyTemplate ? [`policy ${view.policyTemplate}`] : []),
    ...signatureSummary(view),
    ...retryPolicySummary(view),
    ...attemptSummary(view),
    ...(view.schemaVersion !== undefined
      ? [`schema ${view.schemaVersion}`]
      : []),
    ...(view.deliveryCount !== undefined
      ? [`deliveries ${view.deliveryCount}`]
      : []),
    ...qualificationSummary(view),
    ...(view.retriedCount !== undefined
      ? [`retried ${view.retriedCount}`]
      : []),
    ...(view.skippedCount !== undefined
      ? [`skipped ${view.skippedCount}`]
      : []),
    ...(view.revision !== undefined ? [`revision ${view.revision}`] : []),
    ...(view.channelRevision !== undefined
      ? [`channel-revision ${view.channelRevision}`]
      : []),
    ...(view.tokenFingerprint ? [`token-fp ${view.tokenFingerprint}`] : []),
    ...(view.previousTokenFingerprint
      ? [`previous-token-fp ${view.previousTokenFingerprint}`]
      : []),
    ...(view.idempotencyFingerprint
      ? [`idempotency-fp ${view.idempotencyFingerprint}`]
      : []),
    ...(view.nextAttemptAt ? [`next-attempt ${view.nextAttemptAt}`] : []),
    ...hashSummaries(view),
  ].join(" / ");
}

function signatureSummary(view: ChannelEventTraceView): string[] {
  return [
    ...(view.signatureRequired !== undefined
      ? [`signature-required ${view.signatureRequired}`]
      : []),
    ...(view.required !== undefined ? [`required ${view.required}`] : []),
    ...(view.previousRequired !== undefined
      ? [`previous-required ${view.previousRequired}`]
      : []),
    ...(view.signatureAlgorithm
      ? [`signature-algorithm ${view.signatureAlgorithm}`]
      : []),
    ...(view.toleranceSeconds !== undefined
      ? [`tolerance ${view.toleranceSeconds}s`]
      : []),
    ...(view.previousToleranceSeconds !== undefined
      ? [`previous-tolerance ${view.previousToleranceSeconds}s`]
      : []),
  ];
}

function retryPolicySummary(view: ChannelEventTraceView): string[] {
  return [
    ...(view.retryMaxAttempts !== undefined &&
    view.retryBaseDelayMs !== undefined
      ? [`retry ${view.retryMaxAttempts}/${view.retryBaseDelayMs}ms`]
      : view.retryMaxAttempts !== undefined
        ? [`retry-max ${view.retryMaxAttempts}`]
        : view.retryBaseDelayMs !== undefined
          ? [`retry-base-ms ${view.retryBaseDelayMs}`]
          : []),
    ...(view.previousMaxAttempts !== undefined &&
    view.previousBaseDelayMs !== undefined
      ? [
          `previous-retry ${view.previousMaxAttempts}/${view.previousBaseDelayMs}ms`,
        ]
      : view.previousMaxAttempts !== undefined
        ? [`previous-retry-max ${view.previousMaxAttempts}`]
        : view.previousBaseDelayMs !== undefined
          ? [`previous-retry-base-ms ${view.previousBaseDelayMs}`]
          : []),
    ...(view.maxAttempts !== undefined
      ? [`max-attempts ${view.maxAttempts}`]
      : []),
    ...(view.retryBaseMs !== undefined
      ? [`retry-base-ms ${view.retryBaseMs}`]
      : []),
  ];
}

function attemptSummary(view: ChannelEventTraceView): string[] {
  if (view.attempt !== undefined && view.maxAttempts !== undefined) {
    return [`attempt ${view.attempt}/${view.maxAttempts}`];
  }
  return [
    ...(view.attempt !== undefined ? [`attempt ${view.attempt}`] : []),
    ...(view.attemptCount !== undefined
      ? [`attempt-count ${view.attemptCount}`]
      : []),
  ];
}

function qualificationSummary(view: ChannelEventTraceView): string[] {
  return [
    ...(view.qualifiedCount !== undefined
      ? [`qualified ${view.qualifiedCount}`]
      : []),
    ...(view.evidenceMissingCount !== undefined
      ? [`evidence-missing ${view.evidenceMissingCount}`]
      : []),
    ...(view.adapterCatalogDriftCount !== undefined
      ? [`catalog-drift ${view.adapterCatalogDriftCount}`]
      : []),
  ];
}

function hashSummaries(view: ChannelEventTraceView): string[] {
  return [
    ...hashSummary("body", view.bodySha256),
    ...hashSummary("adapter-catalog", view.adapterCatalogSha256),
    ...hashSummary("content", view.contentSha256),
    ...hashSummary("current-catalog", view.currentAdapterCatalogSha256),
    ...hashSummary("apply", view.applyResultSha256),
    ...hashSummary("preview", view.previewSha256),
    ...hashSummary("artifact", view.artifactSha256),
    ...hashSummary("preview-candidates", view.previewCandidateSetSha256),
    ...hashSummary("preview-retryable", view.previewRetryableDeliveryIdsSha256),
    ...hashSummary("preview-blocked", view.previewBlockedDeliveryIdsSha256),
    ...hashSummary("retried", view.retriedDeliveryIdsSha256),
    ...hashSummary("skipped", view.skippedDeliveryIdsSha256),
  ];
}

function idSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(-10)}`] : [];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function safeTokenField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = safeToken(payload[key]);
  return value ? { [key]: value } : {};
}

function integerField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { [key]: value }
    : {};
}

function booleanField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = payload[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function fingerprintField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = fingerprint(payload[key]);
  return value ? { [key]: value } : {};
}

function safeIsoField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = safeIso(payload[key]);
  return value ? { [key]: value } : {};
}

function shaField(
  payload: Record<string, unknown>,
  key: keyof ChannelEventTraceView,
): Partial<ChannelEventTraceView> {
  const value = sha256(payload[key]);
  return value ? { [key]: value } : {};
}

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value)
    ? value
    : undefined;
}

function fingerprint(value: unknown): string | undefined {
  return typeof value === "string" && FINGERPRINT.test(value)
    ? value
    : undefined;
}

function safeIso(value: unknown): string | undefined {
  return typeof value === "string" && ISO_TIME.test(value) ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}
