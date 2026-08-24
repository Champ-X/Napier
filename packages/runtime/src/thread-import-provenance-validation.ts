import type {
  JsonValue,
  RunEvent,
  ThreadImportProvenance,
  ThreadRecord,
} from "@napier/contracts";
import { storeCanonicalJson as canonicalJson } from "./store-hashing.js";

export const THREAD_IMPORTED_EVENT = "thread.imported";

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function validateThreadImportProvenance(
  thread: ThreadRecord,
  value: unknown,
): ThreadImportProvenance {
  if (!isRecord(value)) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  const allowed = new Set([
    "sourceThreadId",
    "sourceApiVersion",
    "sourceContentSha256",
    "sourceEventStreamSha256",
    "sourceEventCount",
    "localImportedThroughSeq",
    "sourceModelContextEnvelopeCount",
    "sourceEmbeddedModelContextEnvelopeCount",
    "importedAt",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  const sourceEventCount = value["sourceEventCount"];
  const localImportedThroughSeq = value["localImportedThroughSeq"];
  const sourceModelContextEnvelopeCount =
    value["sourceModelContextEnvelopeCount"];
  const sourceEmbeddedModelContextEnvelopeCount =
    value["sourceEmbeddedModelContextEnvelopeCount"];
  if (
    typeof value["sourceThreadId"] !== "string" ||
    !/^[a-z][a-z0-9_]{2,80}$/.test(value["sourceThreadId"]) ||
    typeof value["sourceApiVersion"] !== "string" ||
    value["sourceApiVersion"].length > 64 ||
    !isSha256(value["sourceContentSha256"]) ||
    !isSha256(value["sourceEventStreamSha256"]) ||
    !isNonNegativeInteger(sourceEventCount) ||
    (localImportedThroughSeq !== undefined &&
      (!isNonNegativeInteger(localImportedThroughSeq) ||
        localImportedThroughSeq > thread.eventCount)) ||
    (sourceModelContextEnvelopeCount !== undefined &&
      !isNonNegativeInteger(sourceModelContextEnvelopeCount)) ||
    (sourceEmbeddedModelContextEnvelopeCount !== undefined &&
      !isNonNegativeInteger(sourceEmbeddedModelContextEnvelopeCount)) ||
    typeof value["importedAt"] !== "string" ||
    !Number.isFinite(Date.parse(value["importedAt"]))
  ) {
    throw new Error(
      `Persisted Thread import provenance is invalid: ${thread.id}`,
    );
  }
  return {
    sourceThreadId: value["sourceThreadId"],
    sourceApiVersion: value["sourceApiVersion"],
    sourceContentSha256: value["sourceContentSha256"],
    sourceEventStreamSha256: value["sourceEventStreamSha256"],
    sourceEventCount,
    ...(localImportedThroughSeq !== undefined
      ? { localImportedThroughSeq }
      : {}),
    ...(sourceModelContextEnvelopeCount !== undefined
      ? { sourceModelContextEnvelopeCount }
      : {}),
    ...(sourceEmbeddedModelContextEnvelopeCount !== undefined
      ? { sourceEmbeddedModelContextEnvelopeCount }
      : {}),
    importedAt: value["importedAt"],
  };
}

export function validateThreadImportProvenanceLedgerReceipt(
  thread: ThreadRecord,
  events: RunEvent[],
): void {
  const provenance = thread.importProvenance;
  if (!provenance) return;
  const receipts = events.filter(
    (event) => event.type === THREAD_IMPORTED_EVENT,
  );
  if (receipts.length === 0) return;
  const receipt = receipts[0]!;
  const expectedPayload = threadImportProvenanceEventPayload(provenance);
  if (
    receipts.length !== 1 ||
    receipt.seq !== threadImportProvenanceLocalCutoff(provenance) ||
    receipt.category !== "lifecycle" ||
    receipt.visibility !== "debug" ||
    receipt.createdAt !== provenance.importedAt ||
    canonicalJson(receipt.payload) !== canonicalJson(expectedPayload)
  ) {
    throw new Error(
      `Persisted Thread import provenance receipt is invalid: ${thread.id}`,
    );
  }
}

export function threadImportProvenanceEventPayload(
  provenance: ThreadImportProvenance,
): JsonValue {
  return {
    kind: "napier.thread-import-provenance",
    sourceThreadId: provenance.sourceThreadId,
    sourceApiVersion: provenance.sourceApiVersion,
    sourceContentSha256: provenance.sourceContentSha256,
    sourceEventStreamSha256: provenance.sourceEventStreamSha256,
    sourceEventCount: provenance.sourceEventCount,
    localImportedThroughSeq: threadImportProvenanceLocalCutoff(provenance),
    sourceModelContextEnvelopeCount:
      provenance.sourceModelContextEnvelopeCount ?? 0,
    sourceEmbeddedModelContextEnvelopeCount:
      provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0,
    importedAt: provenance.importedAt,
  };
}

export function threadImportProvenanceLocalCutoff(
  provenance: ThreadImportProvenance,
): number {
  return provenance.localImportedThroughSeq ?? provenance.sourceEventCount;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
