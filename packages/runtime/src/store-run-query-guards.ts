import type {
  OperatorDecision,
  RunEvent,
  ThreadRecord,
} from "@napier/contracts";

import { projectOperatorDecisions } from "./operator-decisions.js";
import type { SqliteLedger } from "./sqlite-ledger.js";

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
