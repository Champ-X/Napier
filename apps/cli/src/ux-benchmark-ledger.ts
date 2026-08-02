import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import { validUxBenchmarkLedgerShape } from "./ux-benchmark-ledger-shape.js";
import type {
  UxBenchmarkLedgerBundle,
  UxBenchmarkLedgerEventReceipt,
  UxBenchmarkResult,
} from "./ux-benchmark-types.js";

const OMITTED_RECEIPT_TYPES = new Set([
  "model.text.delta",
  "model.thinking.delta",
]);
const EMPTY_SHA256 = sha256("");

export function createUxBenchmarkLedgerBundle(input: {
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  model: UxBenchmarkLedgerBundle["model"];
  environment: UxBenchmarkLedgerBundle["environment"];
  run: UxBenchmarkResult["run"];
  expectedOutputSha256: string;
  actualOutputSha256?: string;
  credentialVariableSha256: string;
  cliExitCode: number;
  manualCommandCount: number;
  firstEventMs: number;
  maxFirstEventMs: number;
  totalDurationMs: number;
  maxDurationMs: number;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  threadCountAfter: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  events: RunEvent[];
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
}): UxBenchmarkLedgerBundle {
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const retainedEvents = events.filter(
    (event) => !OMITTED_RECEIPT_TYPES.has(event.type),
  );
  const eventTypeCounts = countEventTypes(events);
  const eventReceipts = createEventReceipts(retainedEvents);
  const content = {
    kind: "napier.ux-benchmark-ledger" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    threadId: input.threadId,
    model: structuredClone(input.model),
    environment: structuredClone(input.environment),
    run: structuredClone(input.run),
    expectedOutputSha256: input.expectedOutputSha256,
    ...(input.actualOutputSha256
      ? { actualOutputSha256: input.actualOutputSha256 }
      : {}),
    credentialVariableSha256: input.credentialVariableSha256,
    cliExitCode: input.cliExitCode,
    manualCommandCount: input.manualCommandCount,
    firstEventMs: input.firstEventMs,
    maxFirstEventMs: input.maxFirstEventMs,
    totalDurationMs: input.totalDurationMs,
    maxDurationMs: input.maxDurationMs,
    credentialReferenceCount: input.credentialReferenceCount,
    credentialProviderMatch: input.credentialProviderMatch,
    credentialLocatorMatch: input.credentialLocatorMatch,
    credentialAvailable: input.credentialAvailable,
    threadCountAfter: input.threadCountAfter,
    replayValid: input.replayValid,
    credentialLeakDetected: input.credentialLeakDetected,
    credentialPersistenceLeakDetected: input.credentialPersistenceLeakDetected,
    evaluationEvent: structuredClone(input.evaluationEvent),
    terminalEvent: structuredClone(input.terminalEvent),
    eventCount: events.length,
    retainedEventCount: retainedEvents.length,
    omittedEventCount: events.length - retainedEvents.length,
    eventTypeCounts,
    eventTypeSetSha256: sha256(canonicalJson(eventTypeCounts)),
    sourceEventStreamSha256: input.sourceEventStreamSha256,
    sourceReplaySha256: input.sourceReplaySha256,
    eventReceipts,
    receiptSetSha256: sha256(canonicalJson(eventReceipts)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function verifyUxBenchmarkLedgerBundle(input: unknown): {
  valid: boolean;
  diagnostics: string[];
  bundleSha256: string;
} {
  if (!validUxBenchmarkLedgerShape(input)) {
    return {
      valid: false,
      diagnostics: ["ledger_shape_invalid"],
      bundleSha256: sha256(String(input)),
    };
  }
  const bundle = input;
  const diagnostics: string[] = [];
  const { contentSha256, ...content } = bundle;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("ledger_hash_mismatch");
  }
  if (!validReceipts(bundle)) diagnostics.push("ledger_receipts_invalid");
  if (!validEventBindings(bundle)) {
    diagnostics.push("ledger_event_binding_invalid");
  }
  if (!validEventAggregates(bundle)) {
    diagnostics.push("ledger_event_aggregates_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    bundleSha256: bundle.contentSha256,
  };
}

function createEventReceipts(
  events: RunEvent[],
): UxBenchmarkLedgerEventReceipt[] {
  let previousReceiptSha256 = EMPTY_SHA256;
  return events.map((event) => {
    const content = {
      id: event.id,
      seq: event.seq,
      runId: event.runId,
      type: event.type,
      category: event.category,
      visibility: event.visibility,
      createdAt: event.createdAt,
      payloadSha256: sha256(canonicalJson(event.payload)),
      previousReceiptSha256,
    };
    const receipt = {
      ...content,
      receiptSha256: sha256(canonicalJson(content)),
    };
    previousReceiptSha256 = receipt.receiptSha256;
    return receipt;
  });
}

function validReceipts(bundle: UxBenchmarkLedgerBundle): boolean {
  let previous = EMPTY_SHA256;
  for (const receipt of bundle.eventReceipts) {
    const { receiptSha256, ...content } = receipt;
    if (
      receipt.previousReceiptSha256 !== previous ||
      sha256(canonicalJson(content)) !== receiptSha256
    ) {
      return false;
    }
    previous = receiptSha256;
  }
  return (
    sha256(canonicalJson(bundle.eventReceipts)) === bundle.receiptSetSha256
  );
}

function validEventBindings(bundle: UxBenchmarkLedgerBundle): boolean {
  return [bundle.evaluationEvent, bundle.terminalEvent].every((event) => {
    const receipt = bundle.eventReceipts.find(
      (candidate) => candidate.id === event.id,
    );
    return (
      receipt?.seq === event.seq &&
      receipt.runId === event.runId &&
      receipt.type === event.type &&
      receipt.payloadSha256 === sha256(canonicalJson(event.payload))
    );
  });
}

function validEventAggregates(bundle: UxBenchmarkLedgerBundle): boolean {
  return (
    bundle.retainedEventCount === bundle.eventReceipts.length &&
    bundle.eventCount ===
      bundle.retainedEventCount + bundle.omittedEventCount &&
    sha256(canonicalJson(bundle.eventTypeCounts)) ===
      bundle.eventTypeSetSha256 &&
    bundle.eventTypeCounts.reduce((sum, entry) => sum + entry.count, 0) ===
      bundle.eventCount
  );
}

function countEventTypes(events: RunEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => ({ type, count }));
}
