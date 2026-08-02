import type {
  InboundChannel,
  InboundDeadLetterExport,
  InboundDeadLetterExportVerification,
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
  InboundDeadLetterRetryPreview,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  safeFilenameSegment,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setInboundDeadLetterExportHeaders(
  context: Context,
  artifact: InboundDeadLetterExport,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Channel-Id", artifact.channel.id);
  context.header("X-Napier-Thread-Id", artifact.channel.threadId);
  context.header("X-Napier-Channel-Status", artifact.channel.status);
  context.header(
    "X-Napier-Channel-Revision",
    String(artifact.channel.revision),
  );
  context.header("X-Napier-Delivery-Count", String(artifact.deliveryCount));
  context.header(
    "X-Napier-Delivery-Ids-SHA256",
    sha256Json(
      artifact.deliveries.map((delivery) => delivery.deliveryId).sort(),
    ),
  );
  context.header(
    "X-Napier-Manual-Retry-Available-Count",
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "manual_retry_available",
      ).length,
    ),
  );
  context.header(
    "X-Napier-Retry-Exhausted-Count",
    String(
      artifact.deliveries.filter(
        (delivery) => delivery.retryDisposition === "retry_exhausted",
      ).length,
    ),
  );
  if (artifact.currentAdapterCatalogSha256) {
    context.header(
      "X-Napier-Current-Adapter-Catalog-SHA256",
      artifact.currentAdapterCatalogSha256,
    );
  }
  if (artifact.qualifiedCount !== undefined) {
    context.header("X-Napier-Qualified-Count", String(artifact.qualifiedCount));
  }
  if (artifact.evidenceMissingCount !== undefined) {
    context.header(
      "X-Napier-Evidence-Missing-Count",
      String(artifact.evidenceMissingCount),
    );
  }
  if (artifact.adapterCatalogDriftCount !== undefined) {
    context.header(
      "X-Napier-Adapter-Catalog-Drift-Count",
      String(artifact.adapterCatalogDriftCount),
    );
  }
  context.header(
    "Content-Disposition",
    `attachment; filename="${inboundDeadLetterExportFilename(artifact)}"`,
  );
}

export function setInboundDeadLetterExportVerificationHeaders(
  context: Context,
  verification: InboundDeadLetterExportVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  if (verification.channelId) {
    context.header("X-Napier-Channel-Id", verification.channelId);
  }
  if (verification.expectedChannelId) {
    context.header(
      "X-Napier-Expected-Channel-Id",
      verification.expectedChannelId,
    );
  }
  if (verification.declaredContentSha256) {
    context.header(
      "X-Napier-Declared-Content-SHA256",
      verification.declaredContentSha256,
    );
  }
  if (verification.recomputedContentSha256) {
    context.header(
      "X-Napier-Recomputed-Content-SHA256",
      verification.recomputedContentSha256,
    );
  }
  if (verification.observedDeliveryCount !== undefined) {
    context.header(
      "X-Napier-Observed-Delivery-Count",
      String(verification.observedDeliveryCount),
    );
  }
  if (verification.observedQualifiedCount !== undefined) {
    context.header(
      "X-Napier-Observed-Qualified-Count",
      String(verification.observedQualifiedCount),
    );
  }
  if (verification.observedEvidenceMissingCount !== undefined) {
    context.header(
      "X-Napier-Observed-Evidence-Missing-Count",
      String(verification.observedEvidenceMissingCount),
    );
  }
  if (verification.observedAdapterCatalogDriftCount !== undefined) {
    context.header(
      "X-Napier-Observed-Adapter-Catalog-Drift-Count",
      String(verification.observedAdapterCatalogDriftCount),
    );
  }
}

export function setInboundDeadLetterRetryPreviewHeaders(
  context: Context,
  preview: InboundDeadLetterRetryPreview,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, preview.contentSha256);
  context.header("X-Napier-Channel-Id", preview.channelId);
  context.header("X-Napier-Verification-Status", preview.verificationStatus);
  if (preview.artifactSha256) {
    context.header("X-Napier-Artifact-SHA256", preview.artifactSha256);
  }
  context.header("X-Napier-Retryable-Count", String(preview.retryableCount));
  context.header("X-Napier-Blocked-Count", String(preview.blockedCount));
  context.header("X-Napier-Candidate-Count", String(preview.candidates.length));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(preview.diagnostics.length),
  );
  context.header("X-Napier-Candidate-Set-SHA256", preview.candidateSetSha256);
  context.header(
    "X-Napier-Retryable-Delivery-Ids-SHA256",
    preview.retryableDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Blocked-Delivery-Ids-SHA256",
    preview.blockedDeliveryIdsSha256,
  );
}

export function setInboundDeadLetterRetryApplyResultHeaders(
  context: Context,
  result: InboundDeadLetterRetryApplyResult,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Channel-Id", result.channelId);
  context.header("X-Napier-Preview-SHA256", result.previewSha256);
  if (result.artifactSha256) {
    context.header("X-Napier-Artifact-SHA256", result.artifactSha256);
  }
  context.header("X-Napier-Retried-Count", String(result.retriedCount));
  context.header("X-Napier-Skipped-Count", String(result.skippedCount));
  context.header(
    "X-Napier-Retried-Delivery-Count",
    String(result.deliveries.length),
  );
  context.header(
    "X-Napier-Skipped-Delivery-Count",
    String(result.skipped.length),
  );
  context.header(
    "X-Napier-Preview-Candidate-Set-SHA256",
    result.previewCandidateSetSha256,
  );
  context.header(
    "X-Napier-Preview-Retryable-Delivery-Ids-SHA256",
    result.previewRetryableDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Preview-Blocked-Delivery-Ids-SHA256",
    result.previewBlockedDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Retried-Delivery-Ids-SHA256",
    result.retriedDeliveryIdsSha256,
  );
  context.header(
    "X-Napier-Skipped-Delivery-Ids-SHA256",
    result.skippedDeliveryIdsSha256,
  );
}

export function setInboundDeadLetterRetryHistoryHeaders(
  context: Context,
  history: InboundDeadLetterRetryHistory,
  channel: InboundChannel,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Channel-Id", history.channelId);
  context.header("X-Napier-Thread-Id", channel.threadId);
  context.header("X-Napier-Event-Set-SHA256", history.eventSetSha256);
  context.header("X-Napier-Event-Count", String(history.eventCount));
  if (history.fromSeq !== undefined) {
    context.header("X-Napier-First-Event-Seq", String(history.fromSeq));
  }
  if (history.toSeq !== undefined) {
    context.header("X-Napier-Last-Event-Seq", String(history.toSeq));
  }
  context.header(
    "Content-Disposition",
    `attachment; filename="${inboundDeadLetterRetryHistoryFilename(history)}"`,
  );
}

export function setInboundDeadLetterRetryHistoryVerificationHeaders(
  context: Context,
  verification: InboundDeadLetterRetryHistoryVerification,
): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  if (verification.channelId) {
    context.header("X-Napier-Channel-Id", verification.channelId);
  }
  if (verification.expectedChannelId) {
    context.header(
      "X-Napier-Expected-Channel-Id",
      verification.expectedChannelId,
    );
  }
  if (verification.observedContentSha256) {
    context.header(
      "X-Napier-Observed-Content-SHA256",
      verification.observedContentSha256,
    );
  }
  if (verification.observedEventSetSha256) {
    context.header(
      "X-Napier-Observed-Event-Set-SHA256",
      verification.observedEventSetSha256,
    );
  }
  if (verification.observedEventCount !== undefined) {
    context.header(
      "X-Napier-Observed-Event-Count",
      String(verification.observedEventCount),
    );
  }
  if (verification.observedFromSeq !== undefined) {
    context.header(
      "X-Napier-Observed-First-Event-Seq",
      String(verification.observedFromSeq),
    );
  }
  if (verification.observedToSeq !== undefined) {
    context.header(
      "X-Napier-Observed-Last-Event-Seq",
      String(verification.observedToSeq),
    );
  }
}

function inboundDeadLetterExportFilename(
  artifact: InboundDeadLetterExport,
): string {
  const safeChannelId = safeFilenameSegment(artifact.channel.id, "channel");
  return `napier-dead-letters-${safeChannelId}-${artifact.contentSha256.slice(0, 12)}.json`;
}

function inboundDeadLetterRetryHistoryFilename(
  history: InboundDeadLetterRetryHistory,
): string {
  const safeChannelId = safeFilenameSegment(history.channelId, "channel");
  return `napier-dead-letter-retry-history-${safeChannelId}-${history.contentSha256.slice(0, 12)}.json`;
}
