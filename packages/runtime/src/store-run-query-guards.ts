import type {
  OperatorDecision,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";

import { projectOperatorDecisions } from "./operator-decisions.js";
import type { SqliteLedger } from "./sqlite-ledger.js";
export { latestPrimaryRun } from "./primary-run-selection.js";

export function assertOrdinaryRunInput(input: { source?: string; executionMode?: string }): void {
  if (input.source === "subagent" || input.executionMode === "subagent")
    throw new Error("Subagent Runs require the internal child execution lifecycle");
}

const OPERATOR_DECISION_EVENT_TYPES = [
  "operator.decision.requested",
  "operator.decision.answered",
  "operator.decision.continued",
  "operator.decision.cancelled",
] as const;

export function findOpenOperatorDecision(
  ledger: SqliteLedger,
  thread: ThreadRecord,
): OperatorDecision | undefined {
  if (thread.eventCount === 0) return undefined;
  return projectOperatorDecisions(
    ledger.listEventsRange(
      thread.id,
      1,
      thread.eventCount,
      OPERATOR_DECISION_EVENT_TYPES,
    ),
  ).find(
    (decision) =>
      decision.status === "pending" || decision.status === "answered",
  );
}

export function parentRunStartEvents(
  ledger: SqliteLedger,
  runId: string | undefined,
): RunEvent[] {
  return runId ? ledger.listRunEvents(runId, 0, ["run.started"]) : [];
}

/** Validate the decision gate before mutating the new Run or Thread. */
export function operatorDecisionForRun(
  ledger: SqliteLedger,
  thread: ThreadRecord,
  input: { operatorDecisionId?: string; parentRunId?: string },
): OperatorDecision | undefined {
  const decision = findOpenOperatorDecision(ledger, thread);
  if (
    decision &&
    (decision.status !== "answered" ||
      input.operatorDecisionId !== decision.id ||
      input.parentRunId !== decision.runId)
  ) {
    throw new Error(`Thread is waiting for operator decision: ${decision.id}`);
  }
  if (!decision && input.operatorDecisionId) {
    throw new Error(
      `Operator decision not found for continuation: ${input.operatorDecisionId}`,
    );
  }
  return decision;
}
