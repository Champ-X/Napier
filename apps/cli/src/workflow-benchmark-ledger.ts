import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
  WorkflowBenchmarkResult,
} from "./workflow-benchmark-types.js";

const TOP_LEVEL_KEYS = keySet(
  "kind schemaVersion generatedAt caseId caseSha256 threadId workflow runs evaluationEvent terminalEvent eventCount retainedEventCount omittedEventCount eventTypeCounts eventTypeSetSha256 sourceEventStreamSha256 sourceReplaySha256 eventReceipts receiptSetSha256 contentSha256",
);
const RECEIPT_KEYS = keySet(
  "id seq runId type category visibility createdAt payloadSha256 previousReceiptSha256 receiptSha256",
);
const EMPTY_SHA256 = sha256("");
const OMITTED_RECEIPT_TYPES = new Set([
  "model.text.delta",
  "model.thinking.delta",
]);

export function createWorkflowBenchmarkLedgerBundle(input: {
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  result: WorkflowBenchmarkResult["workflow"];
  status: WorkflowBenchmarkResult["run"]["status"];
  planId: string;
  threadId: string;
  mapOutputSha256?: string;
  mapRunIds: string[];
  reduceRunId: string;
  runs: RunRecord[];
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
  events: RunEvent[];
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
}): WorkflowBenchmarkLedgerBundle {
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const retainedEvents = events.filter(
    (event) => !OMITTED_RECEIPT_TYPES.has(event.type),
  );
  const eventTypeCounts = countEventTypes(events);
  const eventReceipts = createEventReceipts(retainedEvents);
  const content = {
    kind: "napier.workflow-benchmark-ledger" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    threadId: input.threadId,
    workflow: {
      ...structuredClone(input.result),
      planId: input.planId,
      status: input.status,
      ...(input.mapOutputSha256
        ? { mapOutputSha256: input.mapOutputSha256 }
        : {}),
      mapRunIds: [...input.mapRunIds].sort(),
      reduceRunId: input.reduceRunId,
    },
    runs: input.runs
      .map((run) => ({
        id: run.id,
        status: run.status,
        ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
        ...(run.configuration && "executionMode" in run.configuration
          ? { executionMode: run.configuration.executionMode }
          : {}),
        ...(run.configuration?.contentSha256
          ? { configurationSha256: run.configuration.contentSha256 }
          : {}),
        durationMs:
          run.finishedAt === undefined
            ? 0
            : Math.max(
                0,
                Date.parse(run.finishedAt) - Date.parse(run.startedAt),
              ),
        usage: structuredClone(run.usage),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
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
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function verifyWorkflowBenchmarkLedgerBundle(input: unknown): {
  valid: boolean;
  diagnostics: string[];
  bundleSha256: string;
} {
  const diagnostics: string[] = [];
  if (!validBundleShape(input)) {
    return {
      valid: false,
      diagnostics: ["ledger_shape_invalid"],
      bundleSha256: sha256(String(input)),
    };
  }
  const { contentSha256, ...content } = input;
  if (
    sha256(canonicalJson(content as unknown as JsonValue)) !== contentSha256
  ) {
    diagnostics.push("ledger_hash_mismatch");
  }
  if (!validReceiptChain(input.eventReceipts)) {
    diagnostics.push("ledger_receipt_chain_invalid");
  }
  if (input.receiptSetSha256 !== sha256(canonicalJson(input.eventReceipts))) {
    diagnostics.push("ledger_receipt_set_mismatch");
  }
  const observedTypeCounts = countReceiptTypes(input.eventReceipts);
  const retainedTypeCounts = input.eventTypeCounts.filter(
    (entry) => !OMITTED_RECEIPT_TYPES.has(entry.type),
  );
  if (
    canonicalJson(observedTypeCounts) !== canonicalJson(retainedTypeCounts) ||
    input.eventTypeSetSha256 !== sha256(canonicalJson(input.eventTypeCounts)) ||
    input.eventTypeCounts.reduce((total, entry) => total + entry.count, 0) !==
      input.eventCount
  ) {
    diagnostics.push("ledger_event_types_mismatch");
  }
  const omittedCount = input.eventTypeCounts
    .filter((entry) => OMITTED_RECEIPT_TYPES.has(entry.type))
    .reduce((total, entry) => total + entry.count, 0);
  if (
    input.retainedEventCount !== input.eventReceipts.length ||
    input.omittedEventCount !== omittedCount ||
    input.eventCount !== input.retainedEventCount + input.omittedEventCount ||
    input.evaluationEvent.type !== "benchmark.workflow.evaluated" ||
    input.terminalEvent.type !== "workflow.completed"
  ) {
    diagnostics.push("ledger_event_binding_invalid");
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    bundleSha256: input.contentSha256,
  };
}

function createEventReceipts(
  events: RunEvent[],
): WorkflowBenchmarkLedgerEventReceipt[] {
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

function validBundleShape(
  value: unknown,
): value is WorkflowBenchmarkLedgerBundle {
  if (!exactRecord(value, TOP_LEVEL_KEYS)) return false;
  return (
    value["kind"] === "napier.workflow-benchmark-ledger" &&
    value["schemaVersion"] === 1 &&
    validIsoDate(value["generatedAt"]) &&
    resourceId(value["caseId"]) &&
    digest(value["caseSha256"]) &&
    resourceId(value["threadId"]) &&
    validWorkflow(value["workflow"]) &&
    validRuns(value["runs"]) &&
    validEvaluationEvent(value["evaluationEvent"]) &&
    validTerminalEvent(value["terminalEvent"]) &&
    nonNegativeInteger(value["eventCount"]) &&
    nonNegativeInteger(value["retainedEventCount"]) &&
    nonNegativeInteger(value["omittedEventCount"]) &&
    validEventTypeCounts(value["eventTypeCounts"]) &&
    digest(value["eventTypeSetSha256"]) &&
    digest(value["sourceEventStreamSha256"]) &&
    digest(value["sourceReplaySha256"]) &&
    Array.isArray(value["eventReceipts"]) &&
    value["eventReceipts"].every((receipt) =>
      exactRecord(receipt, RECEIPT_KEYS),
    ) &&
    digest(value["receiptSetSha256"]) &&
    digest(value["contentSha256"])
  );
}

function validWorkflow(value: unknown): boolean {
  const workflow = recordValue(value);
  const mapRunIds = workflow["mapRunIds"];
  return (
    exactRecord(value, [
      "manifestSha256",
      "blueprintSha256",
      "resultSha256",
      "outputSha256",
      "nodeResultCount",
      "completedNodeResultCount",
      "planId",
      "status",
      ...(workflow["mapOutputSha256"] === undefined ? [] : ["mapOutputSha256"]),
      "mapRunIds",
      "reduceRunId",
    ]) &&
    resourceId(workflow["planId"]) &&
    workflow["status"] === "completed" &&
    digest(workflow["manifestSha256"]) &&
    digest(workflow["blueprintSha256"]) &&
    digest(workflow["resultSha256"]) &&
    digest(workflow["outputSha256"]) &&
    (workflow["mapOutputSha256"] === undefined ||
      digest(workflow["mapOutputSha256"])) &&
    Array.isArray(mapRunIds) &&
    mapRunIds.every(resourceId) &&
    new Set(mapRunIds).size === mapRunIds.length &&
    mapRunIds.every((id, index) => index === 0 || mapRunIds[index - 1]! < id) &&
    resourceId(workflow["reduceRunId"]) &&
    nonNegativeInteger(workflow["nodeResultCount"]) &&
    nonNegativeInteger(workflow["completedNodeResultCount"])
  );
}

function validRun(value: unknown): boolean {
  const run = recordValue(value);
  return (
    exactRecord(value, [
      "id",
      "status",
      ...(run["parentRunId"] === undefined ? [] : ["parentRunId"]),
      ...(run["executionMode"] === undefined ? [] : ["executionMode"]),
      ...(run["configurationSha256"] === undefined
        ? []
        : ["configurationSha256"]),
      "durationMs",
      "usage",
    ]) &&
    resourceId(run["id"]) &&
    typeof run["status"] === "string" &&
    (run["parentRunId"] === undefined || resourceId(run["parentRunId"])) &&
    (run["executionMode"] === undefined ||
      typeof run["executionMode"] === "string") &&
    (run["configurationSha256"] === undefined ||
      digest(run["configurationSha256"])) &&
    nonNegativeNumber(run["durationMs"]) &&
    validUsage(run["usage"])
  );
}

function validEvent(value: unknown): value is RunEvent {
  return (
    exactRecord(value, [
      "id",
      "threadId",
      "runId",
      "seq",
      "type",
      "category",
      "visibility",
      "createdAt",
      "payload",
    ]) &&
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    nonNegativeInteger(value["seq"]) &&
    typeof value["type"] === "string" &&
    typeof value["category"] === "string" &&
    typeof value["visibility"] === "string" &&
    validIsoDate(value["createdAt"]) &&
    value["payload"] !== undefined
  );
}

function validRuns(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(validRun)) return false;
  const ids = value.map((run) => String(run["id"]));
  return (
    new Set(ids).size === ids.length &&
    ids.every((id, index) => index === 0 || ids[index - 1]! < id)
  );
}

function validEvaluationEvent(value: unknown): value is RunEvent {
  return (
    validEvent(value) &&
    value.type === "benchmark.workflow.evaluated" &&
    value.category === "evaluation" &&
    value.visibility === "user"
  );
}

function validTerminalEvent(value: unknown): value is RunEvent {
  if (
    !validEvent(value) ||
    value.type !== "workflow.completed" ||
    value.category !== "plan" ||
    value.visibility !== "user"
  ) {
    return false;
  }
  const payload = value.payload;
  if (
    !exactRecord(payload, [
      "schemaVersion",
      "planId",
      "manifestSha256",
      "blueprintSha256",
      "status",
      "planRevision",
      "nodeResultCount",
      "completedNodeCount",
      "skippedNodeCount",
      "outputSha256",
      "resultSha256",
    ])
  ) {
    return false;
  }
  return (
    payload["schemaVersion"] === 1 &&
    resourceId(payload["planId"]) &&
    payload["status"] === "completed" &&
    digest(payload["manifestSha256"]) &&
    digest(payload["blueprintSha256"]) &&
    digest(payload["outputSha256"]) &&
    digest(payload["resultSha256"]) &&
    [
      "planRevision",
      "nodeResultCount",
      "completedNodeCount",
      "skippedNodeCount",
    ].every((key) => nonNegativeInteger(payload[key]))
  );
}

function validEventTypeCount(value: unknown): boolean {
  return (
    exactRecord(value, ["type", "count"]) &&
    typeof value["type"] === "string" &&
    nonNegativeInteger(value["count"])
  );
}

function validEventTypeCounts(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(validEventTypeCount)) return false;
  const types = value.map((entry) => String(entry["type"]));
  return (
    new Set(types).size === types.length &&
    types.every((type, index) => index === 0 || types[index - 1]! < type)
  );
}

function validReceiptChain(
  receipts: WorkflowBenchmarkLedgerEventReceipt[],
): boolean {
  let previous = EMPTY_SHA256;
  let sequence = 0;
  for (const receipt of receipts) {
    const { receiptSha256, ...content } = receipt;
    if (
      receipt.seq <= sequence ||
      receipt.previousReceiptSha256 !== previous ||
      receiptSha256 !== sha256(canonicalJson(content))
    ) {
      return false;
    }
    sequence = receipt.seq;
    previous = receiptSha256;
  }
  return true;
}

function countEventTypes(
  events: RunEvent[],
): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => ({ type, count }));
}

function countReceiptTypes(
  receipts: WorkflowBenchmarkLedgerEventReceipt[],
): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const receipt of receipts) {
    counts.set(receipt.type, (counts.get(receipt.type) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => ({ type, count }));
}

function validUsage(value: unknown): boolean {
  return (
    exactRecord(value, [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
      "costUsd",
    ]) && Object.values(value).every(nonNegativeNumber)
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return record(value) ? value : {};
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function keySet(value: string): readonly string[] {
  return value.split(" ");
}
