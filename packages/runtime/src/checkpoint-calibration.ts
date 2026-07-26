import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type ContextCheckpointCalibrationReport,
  type ContextCheckpointCalibrationSample,
  type ContextCompactionFailureSample,
  type ContextCheckpointSnapshot,
  type JsonValue,
  type RunEvent,
} from "@napier/contracts";

import {
  contextEventText,
  contextMessageEvents,
  hashContextEvents,
  hashContextSummary,
  parseContextCheckpointPayload,
} from "./compaction.js";

export function createContextCheckpointCalibrationReport(
  threadId: string,
  events: RunEvent[],
  generatedAt = new Date(),
): ContextCheckpointCalibrationReport {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Context checkpoint calibration time is invalid");
  }
  const threadEvents = events.filter((event) => event.threadId === threadId);
  const messageEvents = contextMessageEvents(threadEvents);
  const samples = threadEvents
    .filter((event) => event.type === "context.compaction.completed")
    .map((event) => createCheckpointSample(event, messageEvents));
  const failures = threadEvents
    .filter((event) => event.type === "context.compaction.failed")
    .map(createFailureSample);
  const verifiedSamples = samples.filter(
    (sample) => sample.state === "verified",
  );
  const latestValidCheckpoint = verifiedSamples.at(-1);
  const sourceCharacterCount = latestValidCheckpoint?.sourceCharacterCount ?? 0;
  const summaryCharacterCount =
    latestValidCheckpoint?.summaryCharacterCount ?? 0;
  const content = {
    kind: "napier.context-checkpoint-calibration" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    threadId,
    eventStreamSha256: hashEventStream(threadEvents),
    messageEventCount: messageEvents.length,
    checkpointCount: samples.length,
    verifiedCheckpointCount: verifiedSamples.length,
    driftedCheckpointCount: samples.filter(
      (sample) => sample.state === "drifted",
    ).length,
    malformedCheckpointCount: samples.filter(
      (sample) => sample.state === "malformed",
    ).length,
    failureCount: failures.length,
    coveredMessageCount: latestValidCheckpoint?.coveredMessageCount ?? 0,
    coverageRate: ratio(
      latestValidCheckpoint?.coveredMessageCount ?? 0,
      messageEvents.length,
    ),
    sourceCharacterCount,
    summaryCharacterCount,
    compressionRatio: compressionRatio(
      sourceCharacterCount,
      summaryCharacterCount,
    ),
    fallbackOmittedMessageCount: failures.reduce(
      (total, failure) => total + failure.omittedMessageCount,
      0,
    ),
    ...(latestValidCheckpoint?.checkpointId
      ? { latestValidCheckpointId: latestValidCheckpoint.checkpointId }
      : {}),
    ...(latestValidCheckpoint
      ? {
          latestValidCheckpointSampleSha256: latestValidCheckpoint.sampleSha256,
        }
      : {}),
    samples,
    failures,
  };
  return {
    ...content,
    generatedAt: generatedAt.toISOString(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

function createCheckpointSample(
  event: RunEvent,
  messageEvents: RunEvent[],
): ContextCheckpointCalibrationSample {
  const checkpoint = parseContextCheckpointPayload(event.payload);
  if (!checkpoint) {
    return withSampleHash({
      eventId: event.id,
      ...(event.runId ? { runId: event.runId } : {}),
      seq: event.seq,
      state: "malformed",
      reason: "payload_schema_invalid",
      coveredMessageCount: 0,
      sourceCharacterCount: 0,
      summaryCharacterCount: 0,
      compressionRatio: 0,
      decisionCount: 0,
      openLoopCount: 0,
      artifactCount: 0,
    });
  }
  const source = messageEvents.filter(
    (message) =>
      message.seq >= checkpoint.fromSeq && message.seq <= checkpoint.toSeq,
  );
  const sourceCharacterCount = source.reduce(
    (total, message) => total + contextEventText(message).length,
    0,
  );
  const summaryCharacterCount = checkpointSummaryCharacterCount(checkpoint);
  const sourceMatches =
    source.length === checkpoint.sourceEventCount &&
    source[0]?.seq === checkpoint.fromSeq &&
    source.at(-1)?.seq === checkpoint.toSeq &&
    hashContextEvents(source) === checkpoint.sourceSha256;
  const summaryMatches =
    hashContextSummary(checkpoint) === checkpoint.summarySha256;
  return withSampleHash({
    eventId: event.id,
    ...(event.runId ? { runId: event.runId } : {}),
    seq: event.seq,
    state: sourceMatches && summaryMatches ? "verified" : "drifted",
    reason:
      sourceMatches && summaryMatches
        ? "source_and_summary_hash_verified"
        : sourceMatches
          ? "summary_hash_mismatch"
          : summaryMatches
            ? "source_hash_mismatch"
            : "source_and_summary_hash_mismatch",
    checkpointId: checkpoint.checkpointId,
    ...(checkpoint.parentCheckpointId
      ? { parentCheckpointId: checkpoint.parentCheckpointId }
      : {}),
    fromSeq: checkpoint.fromSeq,
    toSeq: checkpoint.toSeq,
    retainedFromSeq: checkpoint.retainedFromSeq,
    sourceEventCount: checkpoint.sourceEventCount,
    coveredMessageCount: source.length,
    sourceCharacterCount,
    summaryCharacterCount,
    compressionRatio: compressionRatio(
      sourceCharacterCount,
      summaryCharacterCount,
    ),
    decisionCount: checkpoint.decisions.length,
    openLoopCount: checkpoint.openLoops.length,
    artifactCount: checkpoint.artifacts.length,
    sourceSha256: checkpoint.sourceSha256,
    summarySha256: checkpoint.summarySha256,
  });
}

function createFailureSample(event: RunEvent): ContextCompactionFailureSample {
  const payload = objectPayload(event.payload);
  const message =
    typeof payload["message"] === "string" ? payload["message"] : "";
  const content = {
    eventId: event.id,
    ...(event.runId ? { runId: event.runId } : {}),
    seq: event.seq,
    fromSeq: numericPayload(payload, "fromSeq"),
    toSeq: numericPayload(payload, "toSeq"),
    retainedFromSeq: numericPayload(payload, "retainedFromSeq"),
    sourceEventCount: numericPayload(payload, "sourceEventCount"),
    fallbackMessageCount: numericPayload(payload, "fallbackMessageCount"),
    omittedMessageCount: numericPayload(payload, "omittedMessageCount"),
    messageSha256: sha256(message),
  };
  return {
    ...content,
    failureSha256: sha256(canonicalJson(content)),
  };
}

function withSampleHash(
  content: Omit<ContextCheckpointCalibrationSample, "sampleSha256">,
): ContextCheckpointCalibrationSample {
  return {
    ...content,
    sampleSha256: sha256(canonicalJson(content)),
  };
}

function checkpointSummaryCharacterCount(
  checkpoint: Pick<
    ContextCheckpointSnapshot,
    "summary" | "decisions" | "openLoops" | "artifacts"
  >,
): number {
  return JSON.stringify({
    summary: checkpoint.summary,
    decisions: checkpoint.decisions,
    openLoops: checkpoint.openLoops,
    artifacts: checkpoint.artifacts,
  }).length;
}

function objectPayload(payload: JsonValue): Record<string, JsonValue> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

function numericPayload(
  payload: Record<string, JsonValue>,
  key: string,
): number {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;
}

function compressionRatio(
  sourceCharacterCount: number,
  summaryCharacterCount: number,
): number {
  return summaryCharacterCount > 0
    ? Number((sourceCharacterCount / summaryCharacterCount).toFixed(6))
    : 0;
}

function hashEventStream(events: RunEvent[]): string {
  return sha256(canonicalJson(events));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}
