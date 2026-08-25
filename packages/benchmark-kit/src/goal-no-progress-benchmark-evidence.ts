import type { GoalState, JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";
import { type LocalStore } from "@napier/runtime/store";

import type {
  GoalNoProgressBenchmarkLedger,
  GoalNoProgressBenchmarkResult,
  GoalNoProgressEventReceipt,
} from "./goal-no-progress-benchmark-types.js";

const EMPTY_SHA256 = sha256("");
const OMITTED_RECEIPT_TYPES = new Set([
  "model.text.delta",
  "model.thinking.delta",
]);

export async function appendGoalModelObservation(input: {
  store: Pick<LocalStore, "appendEvent">;
  threadId: string;
  runId: string;
  events: RunEvent[];
  sourceReplaySha256: string;
}): Promise<RunEvent> {
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
  return input.store.appendEvent({
    threadId: input.threadId,
    runId: input.runId,
    type: "benchmark.goal.model-responses.observed",
    category: "evaluation",
    visibility: "debug",
    payload: {
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
    },
  });
}

export function createGoalNoProgressLedger(input: {
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  goal: GoalState;
  events: RunEvent[];
  replaySha256: string;
  modelObservationEvent: RunEvent;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
}): GoalNoProgressBenchmarkLedger {
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const receipts = createEventReceipts(events);
  const content = {
    kind: "napier.goal-no-progress-benchmark-ledger" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    threadId: input.threadId,
    runId: input.runId,
    goal: {
      objectiveSha256: sha256(input.goal.objective),
      objectiveBytes: Buffer.byteLength(input.goal.objective, "utf8"),
      status: input.goal.status,
      blocker: input.goal.blocker,
      continuationCount: input.goal.continuationCount,
      noProgressCount: input.goal.noProgressCount,
      maxNoProgressContinuations: input.goal.maxNoProgressContinuations,
      ...(input.goal.lastEvidenceHash
        ? { lastEvidenceHash: input.goal.lastEvidenceHash }
        : {}),
      ...(input.goal.lastEvaluatedRunId
        ? { lastEvaluatedRunId: input.goal.lastEvaluatedRunId }
        : {}),
    },
    goalEvents: events.filter((event) => event.type.startsWith("goal.")),
    assistantEvents: events.filter(
      (event) =>
        event.runId === input.runId && event.type === "message.assistant",
    ),
    modelResponseObservationEvent: structuredClone(input.modelObservationEvent),
    evaluationEvent: structuredClone(input.evaluationEvent),
    terminalEvent: structuredClone(input.terminalEvent),
    eventCount: events.length,
    sourceReplaySha256: input.replaySha256,
    eventReceipts: receipts,
    receiptSetSha256: sha256(canonicalJson(receipts)),
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function createGoalNoProgressResult(
  content: Omit<GoalNoProgressBenchmarkResult, "contentSha256">,
): GoalNoProgressBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function goalNoProgressLedgerFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-goal-no-progress-benchmark-ledger-${caseId}-${digest.slice(0, 16)}.json`;
}

export function goalNoProgressResultFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-goal-no-progress-benchmark-result-${caseId}-${digest.slice(0, 16)}.json`;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function createEventReceipts(events: RunEvent[]): GoalNoProgressEventReceipt[] {
  let previousReceiptSha256 = EMPTY_SHA256;
  return events
    .filter((event) => !OMITTED_RECEIPT_TYPES.has(event.type))
    .map((event) => {
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

function validUsage(value: unknown): boolean {
  const usage = recordValue(value);
  return (
    [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ].every(
      (key) => Number.isSafeInteger(usage[key]) && Number(usage[key]) >= 0,
    ) &&
    typeof usage["costUsd"] === "number" &&
    Number.isFinite(usage["costUsd"]) &&
    Number(usage["costUsd"]) >= 0
  );
}
