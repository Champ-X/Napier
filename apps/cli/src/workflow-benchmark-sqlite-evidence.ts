import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
} from "./workflow-benchmark-types.js";

export type WorkflowBenchmarkSqliteAction = "schema" | "query" | "chart";

const EVENT_KEYS = keySet(
  "id threadId runId seq type category visibility createdAt payload",
);
const PAYLOAD_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted resultSha256 details",
);
const QUERY_DETAILS_KEYS = keySet(
  "kind schemaVersion action databasePathSha256 databaseSha256 databaseBytes sqlSha256 parameterCount parameterSetSha256 columnCount rowCount truncated columnsSha256 rowsSha256 durationMs workerSha256 runtimeSha256 limitsSha256 resultSha256",
);
const CHART_DETAILS_KEYS = keySet(
  "kind schemaVersion action databasePathSha256 databaseSha256 databaseBytes sqlSha256 parameterCount parameterSetSha256 columnCount rowCount truncated columnsSha256 rowsSha256 durationMs workerSha256 runtimeSha256 limitsSha256 chartType pointCount width height chartSpecSha256 svgSha256 svgBytes rendererSha256 chartLimitsSha256 queryResultSha256 resultSha256",
);

export function collectWorkflowBenchmarkSqliteActionEvents(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
): RunEvent[] {
  return events
    .filter(
      (event) =>
        mapRunIds.has(event.runId) &&
        workflowBenchmarkSqliteAction(event) !== undefined,
    )
    .map((event) => structuredClone(event))
    .sort((left, right) => left.seq - right.seq);
}

export function workflowBenchmarkSqliteActionCounts(events: RunEvent[]): {
  schema: number;
  query: number;
  chart: number;
} {
  const counts = { schema: 0, query: 0, chart: 0 };
  for (const event of events) {
    const action = workflowBenchmarkSqliteAction(event);
    if (action) counts[action] += 1;
  }
  return counts;
}

export function workflowBenchmarkSqliteAction(
  event: RunEvent,
): WorkflowBenchmarkSqliteAction | undefined {
  if (
    event.type !== "tool.completed" ||
    !record(event.payload) ||
    event.payload["toolName"] !== "sqlite_query"
  ) {
    return undefined;
  }
  const details = record(event.payload["details"])
    ? event.payload["details"]
    : {};
  const action = details["action"];
  return action === "schema" || action === "query" || action === "chart"
    ? action
    : undefined;
}

export function validWorkflowBenchmarkSqliteFields(
  workflow: Record<string, unknown>,
): boolean {
  const events = workflow["sqliteActionEvents"];
  const before = workflow["databaseBeforeSha256"];
  const after = workflow["databaseAfterSha256"];
  if (events === undefined && before === undefined && after === undefined) {
    return true;
  }
  return (
    Array.isArray(events) &&
    events.length <= 30 &&
    events.every(validSqliteActionEvent) &&
    digest(before) &&
    digest(after)
  );
}

export function validWorkflowBenchmarkSqliteEvidenceBinding(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const events = bundle.workflow.sqliteActionEvents;
  const before = bundle.workflow.databaseBeforeSha256;
  const after = bundle.workflow.databaseAfterSha256;
  if (events === undefined && before === undefined && after === undefined) {
    return true;
  }
  if (!events || !before || !after) return false;
  const mapRunIds = new Set(bundle.workflow.mapRunIds);
  return (
    eventsRespectSchemaOrder(events, mapRunIds) &&
    events.every(
      (event) =>
        sqliteEventDatabaseSha256(event) === before &&
        receiptMatchesEvent(bundle.eventReceipts, event),
    )
  );
}

export function workflowBenchmarkSqliteProtocolValid(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
): boolean {
  if (mapRunIds.size === 0 || !eventsRespectSchemaOrder(events, mapRunIds)) {
    return false;
  }
  return [...mapRunIds].every((runId) => {
    const actions = events
      .filter((event) => event.runId === runId)
      .map(workflowBenchmarkSqliteAction);
    return (
      actions[0] === "schema" &&
      actions.some((action) => action === "query" || action === "chart")
    );
  });
}

function eventsRespectSchemaOrder(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
): boolean {
  if (
    new Set(events.map((event) => event.id)).size !== events.length ||
    events.some(
      (event, index) =>
        !mapRunIds.has(event.runId) ||
        (index > 0 && event.seq <= events[index - 1]!.seq),
    )
  ) {
    return false;
  }
  const schemaRuns = new Set<string>();
  for (const event of events) {
    const action = workflowBenchmarkSqliteAction(event);
    if (action === "schema") schemaRuns.add(event.runId);
    else if (!schemaRuns.has(event.runId)) return false;
  }
  return true;
}

function receiptMatchesEvent(
  receipts: WorkflowBenchmarkLedgerEventReceipt[],
  event: RunEvent,
): boolean {
  const receipt = receipts.find((candidate) => candidate.id === event.id);
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

function validSqliteActionEvent(value: unknown): value is RunEvent {
  if (
    !exactRecord(value, EVENT_KEYS) ||
    !exactRecord(value["payload"], PAYLOAD_KEYS)
  ) {
    return false;
  }
  return (
    validSqliteEventIdentity(value) && validSqliteEventPayload(value["payload"])
  );
}

function validSqliteEventIdentity(event: Record<string, unknown>): boolean {
  return (
    resourceId(event["id"]) &&
    resourceId(event["threadId"]) &&
    resourceId(event["runId"]) &&
    nonNegativeInteger(event["seq"]) &&
    event["type"] === "tool.completed" &&
    event["category"] === "tool" &&
    event["visibility"] === "user" &&
    validIsoDate(event["createdAt"])
  );
}

function validSqliteEventPayload(payload: Record<string, unknown>): boolean {
  return (
    boundedString(payload["callId"], 1, 200) &&
    payload["toolName"] === "sqlite_query" &&
    payload["status"] === "completed" &&
    digest(payload["outputTextSha256"]) &&
    nonNegativeInteger(payload["outputTextBytes"]) &&
    digest(payload["outputSha256"]) &&
    nonNegativeInteger(payload["outputBytes"]) &&
    payload["outputRedacted"] === true &&
    digest(payload["resultSha256"]) &&
    validSqliteDetails(payload["details"]) &&
    payload["resultSha256"] ===
      sha256(canonicalJson(payload["details"] as JsonValue))
  );
}

function validSqliteDetails(value: unknown): boolean {
  if (!record(value)) return false;
  const chart = value["action"] === "chart";
  return (
    exactRecord(value, chart ? CHART_DETAILS_KEYS : QUERY_DETAILS_KEYS) &&
    validSqliteCommonDetails(value) &&
    (chart ? validSqliteChartDetails(value) : validSqliteQueryDetails(value))
  );
}

function validSqliteCommonDetails(details: Record<string, unknown>): boolean {
  return (
    details["schemaVersion"] === 1 &&
    digest(details["databasePathSha256"]) &&
    digest(details["databaseSha256"]) &&
    nonNegativeInteger(details["databaseBytes"]) &&
    digest(details["sqlSha256"]) &&
    nonNegativeInteger(details["parameterCount"]) &&
    digest(details["parameterSetSha256"]) &&
    nonNegativeInteger(details["columnCount"]) &&
    nonNegativeInteger(details["rowCount"]) &&
    typeof details["truncated"] === "boolean" &&
    digest(details["columnsSha256"]) &&
    digest(details["rowsSha256"]) &&
    nonNegativeNumber(details["durationMs"]) &&
    digest(details["workerSha256"]) &&
    digest(details["runtimeSha256"]) &&
    digest(details["limitsSha256"]) &&
    digest(details["resultSha256"])
  );
}

function validSqliteQueryDetails(details: Record<string, unknown>): boolean {
  return (
    details["kind"] === "napier.sqlite-query" &&
    (details["action"] === "schema" || details["action"] === "query")
  );
}

function validSqliteChartDetails(details: Record<string, unknown>): boolean {
  return (
    details["kind"] === "napier.sqlite-chart" &&
    details["action"] === "chart" &&
    (details["chartType"] === "bar" || details["chartType"] === "line") &&
    nonNegativeInteger(details["pointCount"]) &&
    nonNegativeInteger(details["width"]) &&
    nonNegativeInteger(details["height"]) &&
    digest(details["chartSpecSha256"]) &&
    digest(details["svgSha256"]) &&
    nonNegativeInteger(details["svgBytes"]) &&
    digest(details["rendererSha256"]) &&
    digest(details["chartLimitsSha256"]) &&
    digest(details["queryResultSha256"])
  );
}

function sqliteEventDatabaseSha256(event: RunEvent): string | undefined {
  const payload = record(event.payload) ? event.payload : {};
  const details = record(payload["details"]) ? payload["details"] : {};
  return typeof details["databaseSha256"] === "string"
    ? details["databaseSha256"]
    : undefined;
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

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function resourceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value);
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
