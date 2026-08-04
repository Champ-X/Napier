import type {
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import { canonicalJson, sha256, type LocalStore } from "@napier/runtime";

import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
} from "./workflow-benchmark-types.js";
import { findWorkflowBenchmarkTerminalEvent } from "./workflow-benchmark-terminal-event.js";

const EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const PAYLOAD_KEYS = keySet(
  "schemaVersion sourceReplaySha256 sourceEventCount modelResponseCount modelResponseErrorCount modelResponseUsageSampleCount responseSetSha256",
);

export function createWorkflowBenchmarkModelResponseObservation(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  events: RunEvent[];
  sourceReplaySha256: string;
}): JsonValue | undefined {
  if (input.benchmarkCase.schemaVersion !== 6) return undefined;
  const responses = input.events
    .filter((event) => event.type === "model.response")
    .map((event) => {
      const payload = recordValue(event.payload);
      return {
        eventId: event.id,
        eventSeq: event.seq,
        runId: event.runId,
        payloadSha256: sha256(canonicalJson(event.payload)),
        error:
          payload["stopReason"] === "error" ||
          payload["stopReason"] === "aborted",
        usagePresent: validUsage(payload["usage"]),
      };
    });
  return {
    schemaVersion: 1,
    sourceReplaySha256: input.sourceReplaySha256,
    sourceEventCount: input.events.length,
    modelResponseCount: responses.length,
    modelResponseErrorCount: responses.filter((response) => response.error)
      .length,
    modelResponseUsageSampleCount: responses.filter(
      (response) => response.usagePresent,
    ).length,
    responseSetSha256: sha256(canonicalJson(responses)),
  };
}

export async function appendWorkflowBenchmarkModelResponseObservation(input: {
  store: Pick<LocalStore, "appendEvent">;
  benchmarkCase: WorkflowBenchmarkCase;
  events: RunEvent[];
  sourceReplaySha256: string;
  threadId: string;
  workflowResult: ExecutionPlanWorkflowResult;
  runs: RunRecord[];
}): Promise<{ event?: RunEvent; runId: string }> {
  const runId =
    input.workflowResult.nodeResults.find((result) => result.runId)?.runId ??
    input.runs[0]?.id ??
    findWorkflowBenchmarkTerminalEvent(input.events, input.workflowResult)
      ?.runId;
  if (!runId) {
    throw new Error("Workflow benchmark has no Run for evaluation evidence");
  }
  const payload = createWorkflowBenchmarkModelResponseObservation(input);
  if (!payload) return { runId };
  const event = await input.store.appendEvent({
    threadId: input.threadId,
    runId,
    type: "benchmark.workflow.model-responses.observed",
    category: "evaluation",
    visibility: "debug",
    payload,
  });
  return { event, runId };
}

export function workflowBenchmarkModelEvaluationEvidence(
  event: RunEvent | undefined,
) {
  const payload = recordValue(event?.payload);
  return event
    ? {
        modelResponseCount: Number(payload["modelResponseCount"]),
        modelResponseErrorCount: Number(payload["modelResponseErrorCount"]),
        modelResponseUsageSampleCount: Number(
          payload["modelResponseUsageSampleCount"],
        ),
      }
    : {};
}

export function workflowBenchmarkModelLedgerEvidence(
  event: RunEvent | undefined,
): Pick<
  WorkflowBenchmarkLedgerBundle["workflow"],
  "modelResponseEvidenceEvent"
> {
  return event ? { modelResponseEvidenceEvent: structuredClone(event) } : {};
}

export function workflowBenchmarkModelEvaluationFromBundle(
  bundle: WorkflowBenchmarkLedgerBundle,
) {
  return workflowBenchmarkModelEvaluationEvidence(
    bundle.workflow.modelResponseEvidenceEvent,
  );
}

export function workflowBenchmarkModelEvaluationProjection(input: {
  benchmarkCase: { schemaVersion: number };
  modelResponseCount?: number;
  modelResponseErrorCount?: number;
  modelResponseUsageSampleCount?: number;
}) {
  return input.benchmarkCase.schemaVersion === 6 &&
    input.modelResponseCount !== undefined &&
    input.modelResponseErrorCount !== undefined &&
    input.modelResponseUsageSampleCount !== undefined
    ? {
        modelResponseCount: input.modelResponseCount,
        modelResponseErrorCount: input.modelResponseErrorCount,
        modelResponseUsageSampleCount: input.modelResponseUsageSampleCount,
      }
    : {};
}

export function workflowBenchmarkModelOutcomeInconclusive(input: {
  benchmarkCase: { schemaVersion: number };
  workflowStatus: ExecutionPlanWorkflowResult["status"];
  modelResponseErrorCount?: number;
}): boolean {
  return (
    input.workflowStatus === "cancelled" ||
    (input.benchmarkCase.schemaVersion === 6 &&
      input.workflowStatus !== "completed" &&
      (input.modelResponseErrorCount ?? 0) > 0)
  );
}

export function validWorkflowBenchmarkModelResponseFields(
  workflow: Record<string, unknown>,
): boolean {
  const event = workflow["modelResponseEvidenceEvent"];
  return event === undefined || validModelResponseEvidenceEvent(event);
}

export function validWorkflowBenchmarkModelResponseBinding(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const event = bundle.workflow.modelResponseEvidenceEvent;
  if (!event) return true;
  const payload = recordValue(event.payload);
  const receipt = bundle.eventReceipts.find(
    (candidate) => candidate.id === event.id,
  );
  const responseReceipts = bundle.eventReceipts.filter(
    (candidate) =>
      candidate.type === "model.response" && candidate.seq < event.seq,
  );
  return (
    event.threadId === bundle.threadId &&
    Number(payload["sourceEventCount"]) + 1 === event.seq &&
    event.seq < bundle.evaluationEvent.seq &&
    responseReceipts.length === Number(payload["modelResponseCount"]) &&
    receiptMatchesEvent(receipt, event)
  );
}

function validModelResponseEvidenceEvent(value: unknown): value is RunEvent {
  if (
    !exactRecord(value, EVENT_KEYS) ||
    !exactRecord(value["payload"], PAYLOAD_KEYS)
  ) {
    return false;
  }
  const payload = value["payload"];
  const responseCount = Number(payload["modelResponseCount"]);
  const errorCount = Number(payload["modelResponseErrorCount"]);
  const usageCount = Number(payload["modelResponseUsageSampleCount"]);
  return (
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    nonNegativeInteger(value["seq"]) &&
    value["type"] === "benchmark.workflow.model-responses.observed" &&
    value["category"] === "evaluation" &&
    value["visibility"] === "debug" &&
    validIsoDate(value["createdAt"]) &&
    payload["schemaVersion"] === 1 &&
    digest(payload["sourceReplaySha256"]) &&
    nonNegativeInteger(payload["sourceEventCount"]) &&
    nonNegativeInteger(responseCount) &&
    nonNegativeInteger(errorCount) &&
    nonNegativeInteger(usageCount) &&
    errorCount <= responseCount &&
    usageCount <= responseCount &&
    digest(payload["responseSetSha256"])
  );
}

function receiptMatchesEvent(
  receipt: WorkflowBenchmarkLedgerEventReceipt | undefined,
  event: RunEvent,
): boolean {
  return (
    receipt?.seq === event.seq &&
    receipt.runId === event.runId &&
    receipt.type === event.type &&
    receipt.category === event.category &&
    receipt.visibility === event.visibility &&
    receipt.createdAt === event.createdAt &&
    receipt.payloadSha256 === sha256(canonicalJson(event.payload))
  );
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

function nonNegativeNumber(value: unknown): boolean {
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
