import type {
  RunComparison,
  RunEvent,
  RunReplaySnapshot,
  RunReplaySnapshotVerification,
  ThreadReplayBundle,
  ThreadReplayBundleVerification,
} from "@napier/contracts";
import type { Context } from "hono";

import {
  jsonByteLength,
  safeFilenameSegment,
  setBodyContentSha256Header,
  setEventBoundaryHeaders,
  setRunMetricsHeaders,
  setStableContentSha256Header,
  sha256Json,
} from "./http-response-evidence.js";

export function setThreadEventsProjectionHeaders(
  context: Context,
  threadId: string,
  events: readonly RunEvent[],
  afterSeq: number,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, events);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-After-Seq", String(afterSeq));
  context.header("X-Napier-Event-Count", String(events.length));
  context.header("X-Napier-Event-Bytes", String(jsonByteLength(events)));
  setEventBoundaryHeaders(context, events);
}

export function setThreadReplayBundleHeaders(
  context: Context,
  bundle: ThreadReplayBundle,
  verification: ThreadReplayBundleVerification,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${threadReplayBundleFilename(bundle)}"`,
  );
  setStableContentSha256Header(context, bundle.contentSha256);
  context.header("X-Napier-Thread-Id", bundle.thread.id);
  context.header("X-Napier-Event-Stream-SHA256", bundle.eventStreamSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Run-Count", String(verification.runCount));
  context.header("X-Napier-Plan-Count", String(verification.planCount));
  context.header(
    "X-Napier-Evaluation-Count",
    String(verification.evaluationCount),
  );
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
  setEventBoundaryHeaders(context, bundle.events);
}

export function setThreadReplayBundleVerificationHeaders(
  context: Context,
  verification: ThreadReplayBundleVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Run-Count", String(verification.runCount));
  context.header("X-Napier-Plan-Count", String(verification.planCount));
  context.header(
    "X-Napier-Evaluation-Count",
    String(verification.evaluationCount),
  );
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
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
  if (verification.agentId) {
    context.header("X-Napier-Agent-Id", verification.agentId);
  }
  if (verification.contentSha256) {
    context.header("X-Napier-Bundle-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
}

export function bindRunReplaySnapshotVerification(
  verification: RunReplaySnapshotVerification,
  threadId: string,
  runId: string,
): RunReplaySnapshotVerification {
  if (verification.status !== "valid") return verification;
  if (verification.threadId === threadId && verification.runId === runId) {
    return verification;
  }
  return {
    ...verification,
    status: "invalid",
    diagnostics: ["path_mismatch"],
  };
}

export function setRunReplaySnapshotHeaders(
  context: Context,
  snapshot: RunReplaySnapshot,
): void {
  context.header("Cache-Control", "no-store");
  context.header(
    "Content-Disposition",
    `attachment; filename="${runReplaySnapshotFilename(snapshot)}"`,
  );
  setBodyContentSha256Header(context, snapshot);
  context.header("X-Napier-Thread-Id", snapshot.threadId);
  context.header("X-Napier-Run-Id", snapshot.run.id);
  context.header("X-Napier-Snapshot-SHA256", snapshot.contentSha256);
  context.header("X-Napier-Event-Stream-SHA256", snapshot.eventStreamSha256);
  context.header("X-Napier-Event-Count", String(snapshot.events.length));
  context.header("X-Napier-Subagent-Count", String(snapshot.subagents.length));
  setRunMetricsHeaders(context, "X-Napier-Run", snapshot.metrics);
  if (snapshot.configurationSha256) {
    context.header(
      "X-Napier-Configuration-SHA256",
      snapshot.configurationSha256,
    );
  }
  setEventBoundaryHeaders(context, snapshot.events);
}

export function setRunReplaySnapshotVerificationHeaders(
  context: Context,
  verification: RunReplaySnapshotVerification,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, verification);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Event-Count", String(verification.eventCount));
  context.header("X-Napier-Subagent-Count", String(verification.subagentCount));
  context.header(
    "X-Napier-Model-Context-Envelope-Count",
    String(verification.modelContextEnvelopeCount),
  );
  context.header(
    "X-Napier-Embedded-Model-Context-Envelope-Count",
    String(verification.embeddedModelContextEnvelopeCount),
  );
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
  if (verification.contentSha256) {
    context.header("X-Napier-Snapshot-SHA256", verification.contentSha256);
  }
  if (verification.eventStreamSha256) {
    context.header(
      "X-Napier-Event-Stream-SHA256",
      verification.eventStreamSha256,
    );
  }
  if (verification.configurationSha256) {
    context.header(
      "X-Napier-Configuration-SHA256",
      verification.configurationSha256,
    );
  }
  if (verification.assistantTextSha256) {
    context.header(
      "X-Napier-Assistant-Text-SHA256",
      verification.assistantTextSha256,
    );
  }
}

export function setRunComparisonHeaders(
  context: Context,
  comparison: RunComparison,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, comparison);
  context.header("X-Napier-Thread-Id", comparison.threadId);
  context.header("X-Napier-Left-Run-Id", comparison.left.run.id);
  context.header("X-Napier-Right-Run-Id", comparison.right.run.id);
  context.header(
    "X-Napier-Left-Event-Stream-SHA256",
    comparison.left.eventStreamSha256,
  );
  context.header(
    "X-Napier-Right-Event-Stream-SHA256",
    comparison.right.eventStreamSha256,
  );
  context.header(
    "X-Napier-Left-Event-Count",
    String(comparison.left.events.length),
  );
  context.header(
    "X-Napier-Right-Event-Count",
    String(comparison.right.events.length),
  );
  setRunMetricsHeaders(context, "X-Napier-Left-Run", comparison.left.metrics);
  setRunMetricsHeaders(context, "X-Napier-Right-Run", comparison.right.metrics);
  setRunMetricsHeaders(context, "X-Napier-Run-Delta", comparison.metricDelta);
  context.header("X-Napier-Output-Changed", String(comparison.outputChanged));
  context.header(
    "X-Napier-Configuration-Delta-Status",
    comparison.configurationDelta.status,
  );
  context.header(
    "X-Napier-Context-Coverage-Status",
    comparison.contextCoverageDelta.status,
  );
  context.header(
    "X-Napier-Context-Coverage-Left-Rate",
    String(comparison.contextCoverageDelta.left.coverageRate),
  );
  context.header(
    "X-Napier-Context-Coverage-Right-Rate",
    String(comparison.contextCoverageDelta.right.coverageRate),
  );
  context.header(
    "X-Napier-Context-Coverage-Rate-Delta",
    String(comparison.contextCoverageDelta.coverageRateDelta),
  );
  context.header(
    "X-Napier-Context-Coverage-Left-Embedded-Envelope-Count",
    String(comparison.contextCoverageDelta.left.embeddedEnvelopeCount),
  );
  context.header(
    "X-Napier-Context-Coverage-Right-Embedded-Envelope-Count",
    String(comparison.contextCoverageDelta.right.embeddedEnvelopeCount),
  );
  context.header(
    "X-Napier-Context-Coverage-Embedded-Envelope-Delta",
    String(comparison.contextCoverageDelta.embeddedEnvelopeDelta),
  );
  context.header(
    "X-Napier-Context-Coverage-Diagnostic-Count",
    String(comparison.contextCoverageDelta.diagnostics.length),
  );
  context.header(
    "X-Napier-Context-Coverage-Diagnostics-SHA256",
    sha256Json(comparison.contextCoverageDelta.diagnostics),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Status",
    comparison.traceSummaryBoundaryDelta.status,
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Left-Generic-Count",
    String(comparison.traceSummaryBoundaryDelta.left.generic),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Right-Generic-Count",
    String(comparison.traceSummaryBoundaryDelta.right.generic),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Generic-Delta",
    String(comparison.traceSummaryBoundaryDelta.genericDelta),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Diagnostic-Count",
    String(comparison.traceSummaryBoundaryDelta.diagnostics.length),
  );
  context.header(
    "X-Napier-Trace-Summary-Boundary-Diagnostics-SHA256",
    sha256Json(comparison.traceSummaryBoundaryDelta.diagnostics),
  );
  context.header(
    "X-Napier-Event-Type-Delta-SHA256",
    sha256Json(comparison.eventTypeDelta),
  );
  context.header(
    "X-Napier-Added-Tool-Count",
    String(comparison.addedToolNames.length),
  );
  context.header(
    "X-Napier-Removed-Tool-Count",
    String(comparison.removedToolNames.length),
  );
  context.header(
    "X-Napier-Added-Tools-SHA256",
    sha256Json(comparison.addedToolNames),
  );
  context.header(
    "X-Napier-Removed-Tools-SHA256",
    sha256Json(comparison.removedToolNames),
  );
  setRunConfigurationDeltaHeaders(context, comparison.configurationDelta);
  if (comparison.left.configurationSha256) {
    context.header(
      "X-Napier-Left-Configuration-SHA256",
      comparison.left.configurationSha256,
    );
  }
  if (comparison.right.configurationSha256) {
    context.header(
      "X-Napier-Right-Configuration-SHA256",
      comparison.right.configurationSha256,
    );
  }
}

function threadReplayBundleFilename(bundle: ThreadReplayBundle): string {
  const safeThreadId = safeFilenameSegment(bundle.thread.id, "thread");
  return `napier-thread-${safeThreadId}-${bundle.contentSha256.slice(0, 12)}.json`;
}

function runReplaySnapshotFilename(snapshot: RunReplaySnapshot): string {
  const safeRunId = safeFilenameSegment(snapshot.run.id, "run");
  return `napier-${safeRunId}-replay-${snapshot.contentSha256.slice(0, 12)}.json`;
}

function setRunConfigurationDeltaHeaders(
  context: Context,
  delta: RunComparison["configurationDelta"],
): void {
  context.header(
    "X-Napier-Configuration-Changed-Field-Count",
    String(delta.changedFields.length),
  );
  context.header(
    "X-Napier-Configuration-Changed-Fields-SHA256",
    sha256Json(delta.changedFields),
  );
  context.header(
    "X-Napier-Configuration-Added-Tool-Count",
    String(delta.addedTools.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Tool-Count",
    String(delta.removedTools.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Tools-SHA256",
    sha256Json(delta.addedTools),
  );
  context.header(
    "X-Napier-Configuration-Removed-Tools-SHA256",
    sha256Json(delta.removedTools),
  );
  context.header(
    "X-Napier-Configuration-Added-Skill-Count",
    String(delta.addedSkills.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Skill-Count",
    String(delta.removedSkills.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Skills-SHA256",
    sha256Json(delta.addedSkills),
  );
  context.header(
    "X-Napier-Configuration-Removed-Skills-SHA256",
    sha256Json(delta.removedSkills),
  );
  context.header(
    "X-Napier-Configuration-Added-Subagent-Count",
    String(delta.addedSubagents.length),
  );
  context.header(
    "X-Napier-Configuration-Removed-Subagent-Count",
    String(delta.removedSubagents.length),
  );
  context.header(
    "X-Napier-Configuration-Added-Subagents-SHA256",
    sha256Json(delta.addedSubagents),
  );
  context.header(
    "X-Napier-Configuration-Removed-Subagents-SHA256",
    sha256Json(delta.removedSubagents),
  );
}
