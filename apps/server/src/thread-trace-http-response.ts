import type {
  OpenTelemetryTraceArtifact,
  OpenTelemetryTraceArtifactVerification,
} from "@napier/contracts";
import { openTelemetryTraceArtifactEventAnchorSetSha256 } from "@napier/runtime/core";
import type { Context } from "hono";

import {
  safeFilenameSegment,
  setBodyContentSha256Header,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function bindOpenTelemetryTraceArtifactVerification(
  verification: OpenTelemetryTraceArtifactVerification,
  threadId: string,
): OpenTelemetryTraceArtifactVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId) return verification;
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

export function setOpenTelemetryTraceArtifactHeaders(
  context: Context,
  artifact: OpenTelemetryTraceArtifact,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${openTelemetryTraceArtifactFilename(artifact)}"`,
  );
  setStableContentSha256Header(context, artifact.contentSha256);
  context.header("X-Napier-Trace-Id", artifact.traceId);
  context.header("X-Napier-Thread-Id", artifact.threadId);
  if (artifact.runId) {
    context.header("X-Napier-Run-Id", artifact.runId);
  }
  context.header("X-Napier-Span-Count", String(artifact.spanCount));
  context.header(
    "X-Napier-Event-Count",
    String(artifact.eventRange.eventCount),
  );
  context.header(
    "X-Napier-First-Event-Seq",
    String(artifact.eventRange.fromSeq),
  );
  context.header("X-Napier-Last-Event-Seq", String(artifact.eventRange.toSeq));
  context.header(
    "X-Napier-Event-Stream-SHA256",
    artifact.eventRange.eventStreamSha256,
  );
  context.header(
    "X-Napier-Event-Anchor-Set-SHA256",
    openTelemetryTraceArtifactEventAnchorSetSha256(artifact),
  );
  context.header("X-Napier-Trace-Redaction-Mode", artifact.redaction.mode);
  context.header(
    "X-Napier-Trace-Content-Capture",
    String(artifact.redaction.contentCapture),
  );
  context.header(
    "X-Napier-Trace-Excluded-Event-Type-Count",
    String(artifact.redaction.excludedEventTypes.length),
  );
  context.header(
    "X-Napier-Trace-Excluded-Payload-Key-Count",
    String(artifact.redaction.excludedPayloadKeys.length),
  );
}

export function setOpenTelemetryTraceArtifactVerificationHeaders(
  context: Context,
  verification: OpenTelemetryTraceArtifactVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Span-Count", String(verification.spanCount));
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header(
    "X-Napier-Diagnostic-Count",
    String(verification.diagnostics.length),
  );
  context.header(
    "X-Napier-Diagnostics-SHA256",
    sha256Json(verification.diagnostics),
  );
  if (verification.threadId) {
    context.header("X-Napier-Thread-Id", verification.threadId);
  }
  if (verification.runId) {
    context.header("X-Napier-Run-Id", verification.runId);
  }
  if (verification.traceId) {
    context.header("X-Napier-Trace-Id", verification.traceId);
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Trace-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
  if (verification.eventAnchorSetSha256) {
    context.header(
      "X-Napier-Event-Anchor-Set-SHA256",
      verification.eventAnchorSetSha256,
    );
  }
}

function openTelemetryTraceArtifactFilename(
  artifact: OpenTelemetryTraceArtifact,
): string {
  const sourceId = artifact.runId ?? artifact.threadId;
  const safeSourceId = safeFilenameSegment(sourceId, "trace");
  return `napier-otel-${safeSourceId}-${artifact.contentSha256.slice(0, 12)}.json`;
}
