import type { RunRecord, RunStatus, ThreadStatus } from "@napier/contracts";
import { transitionRunStatus } from "./run-state-machine.js";

type RunOutcome = NonNullable<RunRecord["outcome"]>;

const RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const RUN_OUTCOMES = new Set<RunOutcome>([
  "completed",
  "partial",
  "paused_budget",
  "blocked_capability",
  "blocked_safety",
  "cancelled",
  "failed_unrecoverable",
]);

export function assertOutcome(
  status: unknown,
  outcome: unknown,
  label = "Run",
): void {
  if (typeof status !== "string" || !RUN_STATUSES.has(status as RunStatus)) {
    throw new Error(
      `${outcomeField(label, "status")} is invalid: ${String(status)}`,
    );
  }
  if (outcome === undefined) return;
  if (typeof outcome !== "string" || !RUN_OUTCOMES.has(outcome as RunOutcome)) {
    throw new Error(
      `${outcomeField(label, "outcome")} is invalid: ${String(outcome)}`,
    );
  }
  const compatible =
    (outcome === "completed" && status === "completed") ||
    (outcome === "cancelled" && status === "cancelled") ||
    (outcome !== "completed" && outcome !== "cancelled" && status === "failed");
  if (!compatible) {
    throw new Error(`Run outcome ${outcome} conflicts with status ${status}`);
  }
}

export function applyOutcome(
  run: RunRecord,
  status: Exclude<RunStatus, "queued" | "running">,
  outcome: RunOutcome | undefined,
): void {
  assertOutcome(status, outcome);
  transitionRunStatus(run, status);
  if (outcome) run.outcome = outcome;
}

export function settleThread(
  status: Exclude<RunStatus, "queued" | "running">,
  outcome: RunOutcome | undefined,
  hasActiveRun: boolean,
  hasOpenDecision: boolean,
): ThreadStatus {
  if (hasActiveRun) return "running";
  if (hasOpenDecision) return "waiting";
  if (
    status === "completed" ||
    status === "cancelled" ||
    outcome === "paused_budget" ||
    outcome === "partial"
  ) {
    return "idle";
  }
  return status === "interrupted" ? "waiting" : "failed";
}

function outcomeField(label: string, field: string): string {
  return label.endsWith("]") ? `${label}.${field}` : `${label} ${field}`;
}
