import { Worker } from "node:worker_threads";

import type { RunEvent } from "@napier/contracts";

import {
  normalizeEventQueryTypes,
  validateEventQueryId,
  validateEventQuerySeq,
  type RunEventQueryScope,
} from "./run-event-query-port.js";

type ReadAction =
  | { kind: "thread"; threadId: string; afterSeq: number }
  | { kind: "run"; runId: string; afterSeq: number; types?: string[] }
  | {
      kind: "range";
      threadId: string;
      fromSeq: number;
      toSeq: number;
      types?: string[];
    }
  | { kind: "latest"; scope: RunEventQueryScope }
  | {
      kind: "terminal";
      callId: string;
      scope: Omit<RunEventQueryScope, "types">;
    }
  | { kind: "correlation"; correlationId: string; scope: RunEventQueryScope };

interface PendingRead {
  resolve(value: RunEvent | RunEvent[] | undefined): void;
  reject(error: Error): void;
}

export class SqliteLedgerReadWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRead>();
  private nextRequestId = 1;
  private failure: Error | undefined;
  private closed = false;

  constructor(databasePath: string) {
    this.worker = new Worker(SQLITE_LEDGER_READ_WORKER_SOURCE, {
      eval: true,
      name: "napier-ledger-reader",
      resourceLimits: { maxOldGenerationSizeMb: 128 },
      workerData: databasePath,
    });
    this.worker.unref();
    this.worker.on("message", (message: unknown) => this.settle(message));
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", (code) => {
      if (!this.closed) {
        this.fail(
          new Error(
            `SQLite read worker exited unexpectedly with code ${String(code)}`,
          ),
        );
      }
    });
  }

  listEvents(threadId: string, afterSeq = 0): Promise<RunEvent[]> {
    return this.request({
      kind: "thread",
      threadId: validateEventQueryId(threadId, "Thread ID"),
      afterSeq: validateEventQuerySeq(afterSeq, "afterSeq"),
    }) as Promise<RunEvent[]>;
  }

  listRunEvents(
    runId: string,
    afterSeq = 0,
    types?: readonly string[],
  ): Promise<RunEvent[]> {
    return this.request({
      kind: "run",
      runId: validateEventQueryId(runId, "Run ID"),
      afterSeq: validateEventQuerySeq(afterSeq, "afterSeq"),
      ...normalizedTypes(types),
    }) as Promise<RunEvent[]>;
  }

  listEventsRange(
    threadId: string,
    fromSeq: number,
    toSeq: number,
    types?: readonly string[],
  ): Promise<RunEvent[]> {
    validateEventQuerySeq(fromSeq, "fromSeq", 1);
    validateEventQuerySeq(toSeq, "toSeq", 1);
    if (fromSeq > toSeq)
      throw new Error("Event range requires fromSeq <= toSeq");
    return this.request({
      kind: "range",
      threadId: validateEventQueryId(threadId, "Thread ID"),
      fromSeq,
      toSeq,
      ...normalizedTypes(types),
    }) as Promise<RunEvent[]>;
  }

  findLatestEvent(scope: RunEventQueryScope): Promise<RunEvent | undefined> {
    validateScope(scope, true);
    return this.request({
      kind: "latest",
      scope: { ...scope, ...normalizedTypes(scope.types) },
    }) as Promise<RunEvent | undefined>;
  }

  findToolTerminal(
    callId: string,
    scope: Omit<RunEventQueryScope, "types"> = {},
  ): Promise<RunEvent | undefined> {
    validateScope(scope, false);
    return this.request({
      kind: "terminal",
      callId: validateEventQueryId(callId, "Tool call ID"),
      scope,
    }) as Promise<RunEvent | undefined>;
  }

  listEventsByCorrelationId(
    correlationId: string,
    scope: RunEventQueryScope = {},
  ): Promise<RunEvent[]> {
    validateScope(scope, false);
    return this.request({
      kind: "correlation",
      correlationId: validateEventQueryId(correlationId, "Correlation ID"),
      scope: { ...scope, ...normalizedTypes(scope.types) },
    }) as Promise<RunEvent[]>;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error("SQLite read worker is closed"));
    void this.worker.terminate();
  }

  private request(
    action: ReadAction,
  ): Promise<RunEvent | RunEvent[] | undefined> {
    if (this.failure) return Promise.reject(this.failure);
    if ("types" in action && action.types?.length === 0)
      return Promise.resolve([]);
    if (action.kind === "latest" && action.scope.types?.length === 0)
      return Promise.resolve(undefined);
    if (action.kind === "correlation" && action.scope.types?.length === 0)
      return Promise.resolve([]);
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.ref();
      try {
        this.worker.postMessage({ id, action });
      } catch (error) {
        this.fail(
          error instanceof Error
            ? error
            : new Error(`SQLite read worker failed: ${String(error)}`),
        );
      }
    });
  }

  private settle(message: unknown): void {
    if (!record(message) || !Number.isSafeInteger(message["id"])) return;
    const pending = this.pending.get(Number(message["id"]));
    if (!pending) return;
    this.pending.delete(Number(message["id"]));
    if (this.pending.size === 0) this.worker.unref();
    if (message["ok"] === true)
      pending.resolve(message["value"] as RunEvent | RunEvent[] | undefined);
    else
      pending.reject(
        new Error(String(message["error"] ?? "SQLite read worker failed")),
      );
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) pending.reject(this.failure);
    this.pending.clear();
    this.worker.unref();
  }
}

function normalizedTypes(types: readonly string[] | undefined): {
  types?: string[];
} {
  const normalized = normalizeEventQueryTypes(types);
  return normalized === undefined ? {} : { types: normalized };
}

function validateScope(scope: RunEventQueryScope, requireOwner: boolean): void {
  if (
    requireOwner &&
    scope.threadId === undefined &&
    scope.runId === undefined
  ) {
    throw new Error("Latest event query requires a Thread ID or Run ID");
  }
  if (scope.threadId !== undefined)
    validateEventQueryId(scope.threadId, "Thread ID");
  if (scope.runId !== undefined) validateEventQueryId(scope.runId, "Run ID");
  if (scope.afterSeq !== undefined)
    validateEventQuerySeq(scope.afterSeq, "afterSeq");
  if (scope.atOrBeforeSeq !== undefined)
    validateEventQuerySeq(scope.atOrBeforeSeq, "atOrBeforeSeq", 1);
  normalizeEventQueryTypes(scope.types);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SQLITE_LEDGER_READ_WORKER_SOURCE = String.raw`
const { DatabaseSync } = require("node:sqlite");
const { parentPort, workerData } = require("node:worker_threads");
const database = new DatabaseSync(workerData, {
  readOnly: true,
  enableDoubleQuotedStringLiterals: false,
  allowExtension: false,
});
database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000;");
const terminals = ["tool.completed", "tool.failed", "tool.blocked"];

function predicate(scope, clauses, parameters) {
  if (scope.threadId !== undefined) { clauses.push("thread_id = ?"); parameters.push(scope.threadId); }
  if (scope.runId !== undefined) { clauses.push("run_id = ?"); parameters.push(scope.runId); }
  if (scope.afterSeq !== undefined) { clauses.push("seq > ?"); parameters.push(scope.afterSeq); }
  if (scope.atOrBeforeSeq !== undefined) { clauses.push("seq <= ?"); parameters.push(scope.atOrBeforeSeq); }
  if (scope.types?.length) {
    clauses.push("event_type IN (" + scope.types.map(() => "?").join(", ") + ")");
    parameters.push(...scope.types);
  }
}

function read(action) {
  const clauses = [], parameters = [];
  if (action.kind === "thread") predicate({ threadId: action.threadId, afterSeq: action.afterSeq }, clauses, parameters);
  if (action.kind === "run") predicate({ runId: action.runId, afterSeq: action.afterSeq, types: action.types }, clauses, parameters);
  if (action.kind === "range") predicate({ threadId: action.threadId, types: action.types }, clauses, parameters), clauses.push("seq BETWEEN ? AND ?"), parameters.push(action.fromSeq, action.toSeq);
  if (action.kind === "latest") predicate(action.scope, clauses, parameters);
  if (action.kind === "terminal") predicate(action.scope, clauses, parameters), clauses.unshift("json_extract(event_json, '$.payload.callId') = ?"), parameters.unshift(action.callId), predicate({ types: terminals }, clauses, parameters);
  if (action.kind === "correlation") predicate(action.scope, clauses, parameters), clauses.unshift("json_extract(event_json, '$.payload.correlationId') = ?"), parameters.unshift(action.correlationId);
  const descending = action.kind === "latest" || action.kind === "terminal";
  const sql = "SELECT event_json FROM ledger_events WHERE " + clauses.join(" AND ") + " ORDER BY seq " + (descending ? "DESC LIMIT 1" : "ASC");
  const statement = database.prepare(sql);
  if (descending) return parse(statement.get(...parameters));
  return statement.all(...parameters).map(parse);
}

function parse(row) { return row ? JSON.parse(row.event_json) : undefined; }
parentPort.on("message", ({ id, action }) => {
  try { parentPort.postMessage({ id, ok: true, value: read(action) }); }
  catch (error) { parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
`;
