import type { RunEvent } from "@napier/contracts";

export interface ThreadImportedView {
  sourceContentSha256: string;
  sourceEventStreamSha256: string;
  sourceEventCount: number;
  localImportedThroughSeq: number;
  sourceModelContextEnvelopeCount: number;
  sourceEmbeddedModelContextEnvelopeCount: number;
}

const THREAD_IMPORTED_EVENT = "thread.imported";
const SHA256 = /^[a-f0-9]{64}$/u;
const THREAD_IMPORT_RECEIPT_SUMMARY = "thread import receipt";

export function threadImportedView(
  event: RunEvent,
): ThreadImportedView | undefined {
  if (
    event.type !== THREAD_IMPORTED_EVENT ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const sourceContentSha256 = event.payload["sourceContentSha256"];
  const sourceEventStreamSha256 = event.payload["sourceEventStreamSha256"];
  const sourceEventCount = event.payload["sourceEventCount"];
  const localImportedThroughSeq =
    event.payload["localImportedThroughSeq"] ?? sourceEventCount;
  const sourceModelContextEnvelopeCount =
    event.payload["sourceModelContextEnvelopeCount"] ?? 0;
  const sourceEmbeddedModelContextEnvelopeCount =
    event.payload["sourceEmbeddedModelContextEnvelopeCount"] ?? 0;
  if (
    !isSha256(sourceContentSha256) ||
    !isSha256(sourceEventStreamSha256) ||
    !isNonNegativeInteger(sourceEventCount) ||
    !isNonNegativeInteger(localImportedThroughSeq) ||
    !isNonNegativeInteger(sourceModelContextEnvelopeCount) ||
    !isNonNegativeInteger(sourceEmbeddedModelContextEnvelopeCount)
  ) {
    return undefined;
  }
  return {
    sourceContentSha256,
    sourceEventStreamSha256,
    sourceEventCount,
    localImportedThroughSeq,
    sourceModelContextEnvelopeCount,
    sourceEmbeddedModelContextEnvelopeCount,
  };
}

export function threadImportedSummary(event: RunEvent): string | undefined {
  if (event.type !== THREAD_IMPORTED_EVENT) return undefined;
  const view = threadImportedView(event);
  if (!view) return THREAD_IMPORT_RECEIPT_SUMMARY;
  return [
    `import / ${view.sourceEventCount} source events`,
    `cutoff ${view.localImportedThroughSeq}`,
    `source ${view.sourceContentSha256.slice(0, 12)}`,
    `stream ${view.sourceEventStreamSha256.slice(0, 12)}`,
    `envelopes ${view.sourceModelContextEnvelopeCount}+${view.sourceEmbeddedModelContextEnvelopeCount}`,
  ].join(" / ");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
