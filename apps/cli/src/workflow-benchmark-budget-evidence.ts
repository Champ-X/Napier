import type { RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  WorkflowBenchmarkCase,
  WorkflowBenchmarkDiagnostic,
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
} from "./workflow-benchmark-types.js";

const EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const PAYLOAD_KEYS = keySet("status reason limit observed limits message");
const OBSERVED_KEYS = keySet(
  "turns totalTokens rawTotalTokens costUsd rawCostUsd elapsedMs usage",
);
const LIMIT_KEYS = keySet("maxTurns maxTotalTokens maxCostUsd timeoutMs");
const USAGE_KEYS = keySet(
  "inputTokens outputTokens cacheReadTokens cacheWriteTokens costUsd",
);

interface BudgetEvaluationInput {
  benchmarkCase: { schemaVersion: number };
  workflowStatus: string;
  expectedMapItemCount: number;
  reduceCompletedEventCount: number;
  replayValid: boolean;
  credentialLeakDetected: boolean;
  expectedBudgetReason?: "tokens";
  expectedBudgetTokenLimit?: number;
  expectedBudgetExhaustedRunCount?: number;
  budgetExhaustedRunCount?: number;
  budgetReasonMatch?: boolean;
  budgetLimitMatch?: boolean;
  postBudgetToolCompletedCount?: number;
}

export function workflowBenchmarkBudgetDiagnostics(
  input: BudgetEvaluationInput,
): WorkflowBenchmarkDiagnostic[] {
  if (input.benchmarkCase.schemaVersion !== 8) return [];
  const diagnostics: WorkflowBenchmarkDiagnostic[] = [];
  if (input.workflowStatus !== "blocked") {
    diagnostics.push("workflow_not_blocked");
  }
  if (input.budgetExhaustedRunCount !== input.expectedBudgetExhaustedRunCount) {
    diagnostics.push("budget_exhaustion_mismatch");
  }
  if (input.budgetReasonMatch !== true) {
    diagnostics.push("budget_reason_mismatch");
  }
  if (input.budgetLimitMatch !== true) {
    diagnostics.push("budget_limit_mismatch");
  }
  if ((input.postBudgetToolCompletedCount ?? 0) !== 0) {
    diagnostics.push("budget_side_effect_executed");
  }
  if (input.reduceCompletedEventCount !== 0) {
    diagnostics.push("budget_reduce_executed");
  }
  if (!input.replayValid) diagnostics.push("replay_invalid");
  if (input.credentialLeakDetected) diagnostics.push("credential_leaked");
  return diagnostics;
}

export function workflowBenchmarkBudgetEvaluationProjection(
  input: BudgetEvaluationInput,
) {
  return input.benchmarkCase.schemaVersion === 8
    ? {
        expectedBudgetReason: input.expectedBudgetReason ?? "tokens",
        expectedBudgetTokenLimit: input.expectedBudgetTokenLimit ?? 0,
        expectedBudgetExhaustedRunCount:
          input.expectedBudgetExhaustedRunCount ?? 0,
        budgetExhaustedRunCount: input.budgetExhaustedRunCount ?? 0,
        budgetReasonMatch: input.budgetReasonMatch ?? false,
        budgetLimitMatch: input.budgetLimitMatch ?? false,
        postBudgetToolCompletedCount: input.postBudgetToolCompletedCount ?? 0,
      }
    : {};
}

export function validWorkflowBenchmarkBudgetEvaluationFields(
  evaluation: Record<string, unknown>,
): boolean {
  return (
    evaluation["expectedBudgetReason"] === "tokens" &&
    positiveInteger(evaluation["expectedBudgetTokenLimit"]) &&
    positiveInteger(evaluation["expectedBudgetExhaustedRunCount"]) &&
    nonNegativeInteger(evaluation["budgetExhaustedRunCount"]) &&
    typeof evaluation["budgetReasonMatch"] === "boolean" &&
    typeof evaluation["budgetLimitMatch"] === "boolean" &&
    nonNegativeInteger(evaluation["postBudgetToolCompletedCount"])
  );
}

export function workflowBenchmarkBudgetEvaluationEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  events: RunEvent[];
}) {
  if (input.benchmarkCase.schemaVersion !== 8) return {};
  return budgetEvaluation(
    input.events.filter((event) => event.type === "run.budget.exhausted"),
    input.events,
    input.benchmarkCase.requiredBudgetReason,
    input.benchmarkCase.runTokenLimit,
    input.benchmarkCase.requiredBudgetExhaustedRunCount,
  );
}

export function workflowBenchmarkBudgetEvaluationFromBundle(
  bundle: WorkflowBenchmarkLedgerBundle,
  expectedReason: "tokens",
  expectedTokenLimit: number,
  expectedExhaustedRunCount: number,
) {
  const events = bundle.workflow.budgetExhaustionEvents ?? [];
  return budgetEvaluation(
    events,
    bundle.eventReceipts,
    expectedReason,
    expectedTokenLimit,
    expectedExhaustedRunCount,
  );
}

export function workflowBenchmarkBudgetLedgerEvidence(input: {
  benchmarkCase: WorkflowBenchmarkCase;
  events: RunEvent[];
}): Pick<WorkflowBenchmarkLedgerBundle["workflow"], "budgetExhaustionEvents"> {
  if (input.benchmarkCase.schemaVersion !== 8) return {};
  const events = input.events.filter(
    (event) => event.type === "run.budget.exhausted",
  );
  return events.length === 0
    ? {}
    : {
        budgetExhaustionEvents: events
          .map((event) => structuredClone(event))
          .sort((left, right) => left.seq - right.seq),
      };
}

export function validWorkflowBenchmarkBudgetFields(
  workflow: Record<string, unknown>,
): boolean {
  const events = workflow["budgetExhaustionEvents"];
  return (
    events === undefined ||
    (Array.isArray(events) &&
      events.length >= 1 &&
      events.length <= 8 &&
      events.every(validBudgetEvent) &&
      orderedUniqueEvents(events))
  );
}

export function validWorkflowBenchmarkBudgetBinding(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const events = bundle.workflow.budgetExhaustionEvents;
  if (!events) return true;
  const eventRunIds = new Set(events.map((event) => event.runId));
  const runs = new Map(bundle.runs.map((run) => [run.id, run]));
  return (
    eventRunIds.size === events.length &&
    events.every((event) => {
      const run = runs.get(event.runId);
      return (
        run?.status === "failed" &&
        event.threadId === bundle.threadId &&
        receiptMatchesEvent(
          bundle.eventReceipts.find((receipt) => receipt.id === event.id),
          event,
        )
      );
    }) &&
    !events.some((event) =>
      bundle.eventReceipts.some(
        (receipt) =>
          receipt.runId === event.runId &&
          receipt.type === "tool.completed" &&
          receipt.seq > event.seq,
      ),
    )
  );
}

function budgetEvaluation(
  budgetEvents: RunEvent[],
  receipts: ReadonlyArray<{ runId: string; type: string; seq: number }>,
  expectedReason: "tokens",
  expectedTokenLimit: number,
  expectedExhaustedRunCount: number,
) {
  return {
    expectedBudgetReason: expectedReason,
    expectedBudgetTokenLimit: expectedTokenLimit,
    expectedBudgetExhaustedRunCount: expectedExhaustedRunCount,
    budgetExhaustedRunCount: budgetEvents.length,
    budgetReasonMatch:
      budgetEvents.length > 0 &&
      budgetEvents.every(
        (event) => record(event.payload)["reason"] === expectedReason,
      ),
    budgetLimitMatch:
      budgetEvents.length > 0 &&
      budgetEvents.every(
        (event) => record(event.payload)["limit"] === expectedTokenLimit,
      ),
    postBudgetToolCompletedCount: budgetEvents.reduce(
      (count, event) =>
        count +
        receipts.filter(
          (receipt) =>
            receipt.runId === event.runId &&
            receipt.type === "tool.completed" &&
            receipt.seq > event.seq,
        ).length,
      0,
    ),
  };
}

function validBudgetEvent(value: unknown): value is RunEvent {
  if (
    !exactRecord(value, EVENT_KEYS) ||
    !exactRecord(value["payload"], PAYLOAD_KEYS)
  ) {
    return false;
  }
  const payload = value["payload"];
  const reason = payload["reason"];
  const observed = payload["observed"];
  const limits = payload["limits"];
  return (
    resourceId(value["id"]) &&
    resourceId(value["threadId"]) &&
    resourceId(value["runId"]) &&
    positiveInteger(value["seq"]) &&
    value["type"] === "run.budget.exhausted" &&
    value["category"] === "lifecycle" &&
    value["visibility"] === "user" &&
    validIsoDate(value["createdAt"]) &&
    payload["status"] === "exhausted" &&
    budgetReason(reason) &&
    nonNegativeNumber(payload["limit"]) &&
    validObserved(observed) &&
    validLimits(limits) &&
    validBudgetRelation(reason, Number(payload["limit"]), observed, limits) &&
    boundedString(payload["message"], 1, 300)
  );
}

function validObserved(value: unknown): value is Record<string, unknown> {
  return (
    exactRecord(value, OBSERVED_KEYS) &&
    ["turns", "totalTokens", "rawTotalTokens", "elapsedMs"].every((key) =>
      nonNegativeInteger(value[key]),
    ) &&
    nonNegativeNumber(value["costUsd"]) &&
    nonNegativeNumber(value["rawCostUsd"]) &&
    validUsage(value["usage"])
  );
}

function validLimits(value: unknown): value is Record<string, unknown> {
  return (
    exactRecord(value, LIMIT_KEYS) &&
    positiveInteger(value["maxTurns"]) &&
    positiveInteger(value["maxTotalTokens"]) &&
    nonNegativeNumber(value["maxCostUsd"]) &&
    positiveInteger(value["timeoutMs"])
  );
}

function validBudgetRelation(
  reason: unknown,
  limit: number,
  observed: Record<string, unknown>,
  limits: Record<string, unknown>,
): boolean {
  if (reason === "tokens") {
    return (
      limit === limits["maxTotalTokens"] &&
      Number(observed["totalTokens"]) >= limit
    );
  }
  return true;
}

function validUsage(value: unknown): boolean {
  return (
    exactRecord(value, USAGE_KEYS) &&
    Object.values(value).every(nonNegativeNumber)
  );
}

function orderedUniqueEvents(events: RunEvent[]): boolean {
  return (
    new Set(events.map((event) => event.id)).size === events.length &&
    events.every(
      (event, index) => index === 0 || events[index - 1]!.seq < event.seq,
    )
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

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...keys].sort())
  );
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function budgetReason(value: unknown): boolean {
  return (
    value === "turns" ||
    value === "tokens" ||
    value === "cost" ||
    value === "timeout"
  );
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
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
