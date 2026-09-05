import type { DatabaseSync } from "node:sqlite";

import {
  RUN_TERMINAL_EVENT_TYPES,
  durableTerminalRunStatus,
  terminalRunStatusFromEventType,
  type TerminalRunStatus,
} from "./run-event-admission.js";
import type { SqliteLedgerQuery } from "./sqlite-ledger-query.js";

export function queryTerminalRunStatus(
  query: SqliteLedgerQuery,
  threadId: string,
  runId: string,
): TerminalRunStatus | undefined {
  return durableTerminalRunStatus(
    query.listRunEvents(runId, 0, RUN_TERMINAL_EVENT_TYPES),
    threadId,
    runId,
  );
}

export function readTerminalRunStatus(
  database: DatabaseSync,
  threadId: string,
  runId: string,
): TerminalRunStatus | undefined {
  const row = database
    .prepare(
      `SELECT event_type
       FROM ledger_events
       WHERE thread_id = ?
         AND run_id = ?
         AND event_type IN (?, ?, ?, ?)
       ORDER BY seq ASC
       LIMIT 1`,
    )
    .get(threadId, runId, ...RUN_TERMINAL_EVENT_TYPES) as
    | { event_type: string }
    | undefined;
  return row ? terminalRunStatusFromEventType(row.event_type) : undefined;
}
