import type { RunEvent } from "@napier/contracts";
import { canonicalJson, hashEventStream, sha256 } from "@napier/runtime";

import {
  validCodingBenchmarkLedgerBundleShape,
  validCodingBenchmarkResultShape,
  validCodingBenchmarkToolMetricsShape,
} from "./coding-benchmark-artifact-shape.js";
import type {
  CodingBenchmarkArtifactVerification,
  CodingBenchmarkCase,
  CodingBenchmarkLedgerBundle,
  CodingBenchmarkLedgerBundleV2,
  CodingBenchmarkResult,
  CodingBenchmarkToolMetricsV2,
} from "./coding-benchmark-types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const RESOURCE_ID = /^[a-z][a-z0-9_]{2,80}$/u;
const OMITTED_LEDGER_RECEIPT_TYPES = new Set([
  "model.text.delta",
  "model.thinking.delta",
]);

export function createCodingBenchmarkLedgerBundle(input: {
  generatedAt: string;
  benchmarkCase: CodingBenchmarkCase;
  threadId: string;
  run: CodingBenchmarkLedgerBundle["run"];
  tooling: CodingBenchmarkToolMetricsV2;
  evaluationEvent: RunEvent;
  events: RunEvent[];
  sourceSnapshotSha256: string;
}): CodingBenchmarkLedgerBundleV2 {
  const eventTypeCounts = [
    ...input.events.reduce((counts, event) => {
      counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
  ]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => left.type.localeCompare(right.type));
  const retainedEvents = input.events.filter(
    (event) => !OMITTED_LEDGER_RECEIPT_TYPES.has(event.type),
  );
  let previousReceiptSha256 = "";
  const eventReceipts = retainedEvents.map((event) => {
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
  const content = {
    kind: "napier.coding-benchmark-ledger" as const,
    schemaVersion: 2 as const,
    generatedAt: input.generatedAt,
    caseId: input.benchmarkCase.id,
    caseSha256: input.benchmarkCase.contentSha256,
    threadId: input.threadId,
    run: structuredClone(input.run),
    tooling: structuredClone(input.tooling),
    evaluationEvent: structuredClone(input.evaluationEvent),
    eventCount: input.events.length,
    retainedEventCount: retainedEvents.length,
    omittedEventCount: input.events.length - retainedEvents.length,
    eventTypeCounts,
    eventTypeSetSha256: sha256(canonicalJson(eventTypeCounts)),
    sourceEventStreamSha256: hashEventStream(input.events),
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    eventReceipts,
    receiptSetSha256: sha256(
      canonicalJson(eventReceipts.map((receipt) => receipt.receiptSha256)),
    ),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyCodingBenchmarkArtifacts(
  input: unknown,
  bundleInput: unknown,
): CodingBenchmarkArtifactVerification {
  const diagnostics: string[] = [];
  if (!record(input)) {
    return {
      valid: false,
      diagnostics: ["result_invalid"],
      resultSha256: sha256(String(input)),
    };
  }
  const result = input as unknown as CodingBenchmarkResult;
  if (!validCodingBenchmarkResultShape(input)) {
    diagnostics.push("result_shape_invalid");
  }
  const resultSha256 =
    typeof result.contentSha256 === "string" ? result.contentSha256 : "";
  const { contentSha256: _contentSha256, ...content } = result;
  if (
    !isSha256(resultSha256) ||
    sha256(canonicalJson(content)) !== resultSha256
  ) {
    diagnostics.push("result_hash_mismatch");
  }
  const bundleVerification = verifyCodingBenchmarkLedgerBundle(bundleInput);
  if (!bundleVerification.valid) {
    diagnostics.push("ledger_bundle_invalid");
  }
  const bundle = record(bundleInput)
    ? (bundleInput as unknown as CodingBenchmarkLedgerBundle)
    : undefined;
  if (
    !record(result.ledger) ||
    !bundle ||
    result.generatedAt !== bundle.generatedAt ||
    bundle.contentSha256 !== result.ledger.bundleSha256 ||
    bundle.sourceEventStreamSha256 !== result.ledger.eventStreamSha256 ||
    result.ledger.bundleFileName !==
      `napier-benchmark-ledger-${result.caseId}-${bundle.contentSha256.slice(0, 16)}.json` ||
    Buffer.byteLength(`${JSON.stringify(bundle, null, 2)}\n`, "utf8") !==
      result.ledger.bundleBytes
  ) {
    diagnostics.push("ledger_bundle_mismatch");
  }
  const evaluationEvent = bundle?.evaluationEvent;
  if (
    !record(result.ledger) ||
    !evaluationEvent ||
    evaluationEvent.id !== result.ledger.eventId ||
    evaluationEvent.seq !== result.ledger.eventSeq ||
    sha256(JSON.stringify(evaluationEvent)) !== result.ledger.eventSha256 ||
    !record(evaluationEvent.payload) ||
    evaluationEvent.payload["contentSha256"] !==
      result.evaluation?.contentSha256
  ) {
    diagnostics.push("ledger_evaluation_mismatch");
  }
  if (!benchmarkRunMatches(result, bundle, evaluationEvent)) {
    diagnostics.push("ledger_run_mismatch");
  }
  if (
    result.kind !== "napier.coding-benchmark-result" ||
    (result.schemaVersion !== 1 && result.schemaVersion !== 2) ||
    result.schemaVersion !== bundle?.schemaVersion ||
    result.caseId !== result.evaluation?.caseId ||
    result.caseSha256 !== result.evaluation?.caseSha256 ||
    result.status !== result.evaluation?.status ||
    result.run?.runId !== evaluationEvent?.runId ||
    result.run?.threadId !== evaluationEvent?.threadId
  ) {
    diagnostics.push("result_binding_mismatch");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    resultSha256,
    ...(isSha256(bundle?.contentSha256)
      ? { bundleSha256: bundle.contentSha256 }
      : {}),
  };
}

function benchmarkRunMatches(
  result: CodingBenchmarkResult,
  bundle: CodingBenchmarkLedgerBundle | undefined,
  evaluationEvent: RunEvent | undefined,
): boolean {
  const bundleRun = bundle?.run;
  return Boolean(
    bundleRun &&
    record(result.run) &&
    validCodingBenchmarkToolMetricsShape(
      result.tooling,
      result.schemaVersion,
    ) &&
    validCodingBenchmarkToolMetricsShape(
      bundle.tooling,
      bundle.schemaVersion,
    ) &&
    result.run.runId === bundleRun.id &&
    result.run.agentId === bundleRun.agentId &&
    result.run.agentRevision === bundleRun.agentRevision &&
    result.run.status === bundleRun.status &&
    canonicalJson(result.model) === canonicalJson(bundleRun.model) &&
    result.run.configurationSha256 === bundleRun.configurationSha256 &&
    result.run.durationMs === bundleRun.durationMs &&
    record(result.run.usage) &&
    canonicalJson(result.run.usage) === canonicalJson(bundleRun.usage) &&
    canonicalJson(result.tooling) === canonicalJson(bundle.tooling) &&
    record(result.evaluation) &&
    isSha256(result.evaluation["contentSha256"]) &&
    validEvaluationContentHash(result.evaluation) &&
    canonicalJson(result.evaluation) ===
      canonicalJson(evaluationEvent?.payload),
  );
}

export function verifyCodingBenchmarkLedgerBundle(input: unknown): {
  valid: boolean;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  if (!record(input)) {
    return { valid: false, diagnostics: ["bundle_invalid"] };
  }
  const bundle = input as unknown as CodingBenchmarkLedgerBundle;
  const { contentSha256, ...content } = bundle;
  if (
    !isSha256(contentSha256) ||
    sha256(canonicalJson(content)) !== contentSha256
  ) {
    diagnostics.push("bundle_hash_mismatch");
  }
  if (!validCodingBenchmarkLedgerBundleShape(bundle)) {
    diagnostics.push("bundle_shape_invalid");
    return { valid: false, diagnostics };
  }
  if (
    bundle.eventTypeCounts.some(
      (entry) =>
        !record(entry) ||
        !nonEmptyText(entry["type"]) ||
        !Number.isSafeInteger(entry["count"]) ||
        Number(entry["count"]) < 1,
    ) ||
    bundle.eventTypeCounts.reduce((total, entry) => total + entry.count, 0) !==
      bundle.eventCount ||
    sha256(canonicalJson(bundle.eventTypeCounts)) !== bundle.eventTypeSetSha256
  ) {
    diagnostics.push("event_type_set_mismatch");
  }
  const omittedFromTypes = bundle.eventTypeCounts
    .filter((entry) => OMITTED_LEDGER_RECEIPT_TYPES.has(entry.type))
    .reduce((total, entry) => total + entry.count, 0);
  if (
    omittedFromTypes !== bundle.omittedEventCount ||
    bundle.eventReceipts.some((receipt) =>
      OMITTED_LEDGER_RECEIPT_TYPES.has(receipt.type),
    )
  ) {
    diagnostics.push("omitted_event_count_mismatch");
  }
  validateEventReceipts(bundle, diagnostics);
  validateEvaluationReceipt(bundle, diagnostics);
  return { valid: diagnostics.length === 0, diagnostics };
}

function validateEventReceipts(
  bundle: CodingBenchmarkLedgerBundle,
  diagnostics: string[],
): void {
  let previousReceiptSha256 = "";
  let previousSeq = 0;
  for (const receipt of bundle.eventReceipts) {
    if (
      !record(receipt) ||
      !Number.isSafeInteger(receipt.seq) ||
      receipt.seq <= previousSeq ||
      receipt.seq > bundle.eventCount ||
      !RESOURCE_ID.test(receipt.id ?? "") ||
      !RESOURCE_ID.test(receipt.runId ?? "") ||
      !nonEmptyText(receipt.type) ||
      !nonEmptyText(receipt.category) ||
      !nonEmptyText(receipt.visibility) ||
      !validIsoDate(receipt.createdAt) ||
      !isSha256(receipt.payloadSha256) ||
      receipt.previousReceiptSha256 !== previousReceiptSha256
    ) {
      diagnostics.push("event_receipt_invalid");
      break;
    }
    const { receiptSha256, ...receiptContent } = receipt;
    if (
      !isSha256(receiptSha256) ||
      sha256(canonicalJson(receiptContent)) !== receiptSha256
    ) {
      diagnostics.push("event_receipt_invalid");
      break;
    }
    previousReceiptSha256 = receiptSha256;
    previousSeq = receipt.seq;
  }
  if (
    sha256(
      canonicalJson(
        bundle.eventReceipts.map((receipt) => receipt.receiptSha256),
      ),
    ) !== bundle.receiptSetSha256
  ) {
    diagnostics.push("receipt_set_mismatch");
  }
}

function validateEvaluationReceipt(
  bundle: CodingBenchmarkLedgerBundle,
  diagnostics: string[],
): void {
  const event = bundle.evaluationEvent;
  const receipt = bundle.eventReceipts.find(
    (candidate) =>
      candidate.id === event?.id &&
      candidate.seq === event?.seq &&
      candidate.type === "benchmark.evaluated",
  );
  if (
    !receipt ||
    event.threadId !== bundle.threadId ||
    event.runId !== bundle.run?.id ||
    receipt.payloadSha256 !== sha256(canonicalJson(event.payload))
  ) {
    diagnostics.push("bundle_evaluation_mismatch");
  }
}

function validEvaluationContentHash(
  value: CodingBenchmarkResult["evaluation"],
): boolean {
  const { contentSha256, ...content } = value;
  return sha256(canonicalJson(content)) === contentSha256;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function nonEmptyText(value: unknown): value is string {
  return boundedText(value, 1, 160);
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
