import type { DatabaseSync } from "node:sqlite";

import type { RunEvent } from "@napier/contracts";

import {
  normalizeEventQueryTypes,
  validateEventQueryId,
  validateEventQuerySeq,
  type RunEventQueryScope,
} from "./run-event-query-port.js";

const TOOL_TERMINAL_TYPES = [
  "tool.completed",
  "tool.failed",
  "tool.blocked",
] as const;

type QueryParameter = string | number;

export class SqliteLedgerQuery {
  constructor(private readonly database: DatabaseSync) {}

  listRunEvents(
    runId: string,
    afterSeq = 0,
    types?: readonly string[],
  ): RunEvent[] {
    const normalizedTypes = normalizeEventQueryTypes(types);
    if (normalizedTypes?.length === 0) return [];
    const parameters: QueryParameter[] = [
      validateEventQueryId(runId, "Run ID"),
      validateEventQuerySeq(afterSeq, "afterSeq"),
    ];
    const clauses = ["run_id = ?", "seq > ?"];
    appendTypePredicate(clauses, parameters, normalizedTypes);
    return this.all(clauses, parameters);
  }

  listEventsRange(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): RunEvent[] {
    validateEventQueryId(threadId, "Thread ID");
    validateEventQuerySeq(fromSeq, "fromSeq", 1);
    validateEventQuerySeq(toSeq, "toSeq", 1);
    if (fromSeq > toSeq) {
      throw new Error("Event range requires fromSeq <= toSeq");
    }
    const normalizedTypes = normalizeEventQueryTypes(types);
    if (normalizedTypes?.length === 0) return [];
    const clauses = ["thread_id = ?", "seq BETWEEN ? AND ?"];
    const parameters: QueryParameter[] = [threadId, fromSeq, toSeq];
    appendTypePredicate(clauses, parameters, normalizedTypes);
    return this.all(clauses, parameters);
  }

  findLatestEvent(query: RunEventQueryScope): RunEvent | undefined {
    const built = buildScope(query, true);
    if (built.empty) return undefined;
    return this.first(built.clauses, built.parameters);
  }

  findToolTerminal(
    callId: string,
    scope: Omit<RunEventQueryScope, "types"> = {},
  ): RunEvent | undefined {
    const built = buildScope(scope, false);
    built.clauses.unshift("json_extract(event_json, '$.payload.callId') = ?");
    built.parameters.unshift(validateEventQueryId(callId, "Tool call ID"));
    appendTypePredicate(built.clauses, built.parameters, TOOL_TERMINAL_TYPES);
    return this.first(built.clauses, built.parameters);
  }

  listEventsByCorrelationId(
    correlationId: string,
    scope: RunEventQueryScope = {},
  ): RunEvent[] {
    const built = buildScope(scope, false);
    if (built.empty) return [];
    built.clauses.unshift(
      "json_extract(event_json, '$.payload.correlationId') = ?",
    );
    built.parameters.unshift(
      validateEventQueryId(correlationId, "Correlation ID"),
    );
    return this.all(built.clauses, built.parameters);
  }

  private all(clauses: string[], parameters: QueryParameter[]): RunEvent[] {
    const rows = this.database
      .prepare(
        `SELECT event_json FROM ledger_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY seq ASC`,
      )
      .all(...parameters) as Array<{ event_json: string }>;
    return rows.map(parseEvent);
  }

  private first(
    clauses: string[],
    parameters: QueryParameter[],
  ): RunEvent | undefined {
    const row = this.database
      .prepare(
        `SELECT event_json FROM ledger_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(...parameters) as { event_json: string } | undefined;
    return row ? parseEvent(row) : undefined;
  }
}

function buildScope(
  scope: RunEventQueryScope,
  requireOwner: boolean,
): { clauses: string[]; parameters: QueryParameter[]; empty: boolean } {
  const clauses: string[] = [];
  const parameters: QueryParameter[] = [];
  if (scope.threadId !== undefined) {
    clauses.push("thread_id = ?");
    parameters.push(validateEventQueryId(scope.threadId, "Thread ID"));
  }
  if (scope.runId !== undefined) {
    clauses.push("run_id = ?");
    parameters.push(validateEventQueryId(scope.runId, "Run ID"));
  }
  if (requireOwner && clauses.length === 0) {
    throw new Error("Latest event query requires a Thread ID or Run ID");
  }
  if (scope.afterSeq !== undefined) {
    clauses.push("seq > ?");
    parameters.push(validateEventQuerySeq(scope.afterSeq, "afterSeq"));
  }
  if (scope.atOrBeforeSeq !== undefined) {
    clauses.push("seq <= ?");
    parameters.push(
      validateEventQuerySeq(scope.atOrBeforeSeq, "atOrBeforeSeq", 1),
    );
  }
  const types = normalizeEventQueryTypes(scope.types);
  appendTypePredicate(clauses, parameters, types);
  return { clauses, parameters, empty: types?.length === 0 };
}

function appendTypePredicate(
  clauses: string[],
  parameters: QueryParameter[],
  types: readonly string[] | undefined,
): void {
  if (!types?.length) return;
  clauses.push(`event_type IN (${types.map(() => "?").join(", ")})`);
  parameters.push(...types);
}

function parseEvent(row: { event_json: string }): RunEvent {
  return JSON.parse(row.event_json) as RunEvent;
}
