import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import type {
  WorkflowBenchmarkDataFrameEvidenceExpectation,
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkLedgerEventReceipt,
} from "./workflow-benchmark-types.js";
import { hasExactRunEventEnvelope } from "./run-event-envelope-shape.js";

export type WorkflowBenchmarkDataFrameAction = "inspect_data" | "data_frame";

const PAYLOAD_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted resultSha256 details",
);
const INSPECT_PAYLOAD_KEYS = keySet(
  "callId toolName status outputTextSha256 outputTextBytes outputSha256 outputBytes outputRedacted details",
);
const INSPECT_DETAILS_KEYS = keySet(
  "pathSha256 format sha256 sizeBytes rowCount columnCount truncated columnSetSha256 sampleSha256",
);
const DATA_FRAME_DETAILS_KEYS = keySet(
  "kind schemaVersion action sourcePathSha256 sourceSha256 sourceBytes sourceFormat sourceRowCount sourceColumnCount operationCount planSha256 rowCount columnCount columnsSha256 rowsSha256 outputSha256 outputBytes parserSha256 engineSha256 limitsSha256 resultSha256",
);

export function collectWorkflowBenchmarkDataFrameActionEvents(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
): RunEvent[] {
  return events
    .filter(
      (event) =>
        mapRunIds.has(event.runId) &&
        workflowBenchmarkDataFrameAction(event) !== undefined,
    )
    .map((event) => structuredClone(event))
    .sort((left, right) => left.seq - right.seq);
}

export function workflowBenchmarkDataFrameActionCounts(events: RunEvent[]): {
  inspect: number;
  transform: number;
} {
  const counts = { inspect: 0, transform: 0 };
  for (const event of events) {
    const action = workflowBenchmarkDataFrameAction(event);
    if (action === "inspect_data") counts.inspect += 1;
    if (action === "data_frame") counts.transform += 1;
  }
  return counts;
}

export function workflowBenchmarkDataFrameAction(
  event: RunEvent,
): WorkflowBenchmarkDataFrameAction | undefined {
  if (
    event.type !== "tool.completed" ||
    !record(event.payload) ||
    (event.payload["toolName"] !== "inspect_data" &&
      event.payload["toolName"] !== "data_frame")
  ) {
    return undefined;
  }
  return event.payload["toolName"];
}

export function workflowBenchmarkDataFrameProtocolValid(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
  sourceSha256: string,
): boolean {
  if (
    mapRunIds.size === 0 ||
    events.length !== mapRunIds.size * 2 ||
    !eventsRespectOrder(events, mapRunIds)
  ) {
    return false;
  }
  return [...mapRunIds].every((runId) => {
    const runEvents = events.filter((event) => event.runId === runId);
    return (
      canonicalJson(runEvents.map(workflowBenchmarkDataFrameAction)) ===
        canonicalJson(["inspect_data", "data_frame"]) &&
      inspectionBindsDataFrame(runEvents[0]!, runEvents[1]!, sourceSha256)
    );
  });
}

export function workflowBenchmarkDataFrameEvidenceMatches(
  events: RunEvent[],
  required: WorkflowBenchmarkDataFrameEvidenceExpectation[],
): boolean {
  const actual = events.flatMap((event) => {
    if (workflowBenchmarkDataFrameAction(event) !== "data_frame") return [];
    const details = eventDetails(event);
    return digest(details["rowsSha256"]) &&
      boundedInteger(details["rowCount"], 0, 1_000) &&
      boundedInteger(details["columnCount"], 0, 80)
      ? [
          {
            rowsSha256: details["rowsSha256"],
            rowCount: Number(details["rowCount"]),
            columnCount: Number(details["columnCount"]),
          },
        ]
      : [];
  });
  return (
    actual.length === required.length &&
    canonicalJson(
      actual.sort((left, right) =>
        canonicalJson(left).localeCompare(canonicalJson(right)),
      ),
    ) ===
      canonicalJson(
        [...required].sort((left, right) =>
          canonicalJson(left).localeCompare(canonicalJson(right)),
        ),
      )
  );
}

export function validWorkflowBenchmarkDataFrameFields(
  workflow: Record<string, unknown>,
): boolean {
  return workflowBenchmarkDataFrameFieldDiagnostics(workflow).length === 0;
}

export function workflowBenchmarkDataFrameFieldDiagnostics(
  workflow: Record<string, unknown>,
): string[] {
  const events = workflow["dataFrameActionEvents"];
  const before = workflow["dataSourceBeforeSha256"];
  const after = workflow["dataSourceAfterSha256"];
  const required = workflow["requiredDataFrameEvidence"];
  if (
    events === undefined &&
    before === undefined &&
    after === undefined &&
    required === undefined
  ) {
    return [];
  }
  const diagnostics: string[] = [];
  if (!Array.isArray(events) || events.length > 16) {
    diagnostics.push("data_frame_events_invalid");
  } else {
    events.forEach((event, index) => {
      diagnostics.push(
        ...dataFrameActionEventDiagnostics(event).map(
          (diagnostic) => `data_frame_event_${index + 1}_${diagnostic}`,
        ),
      );
    });
  }
  if (!digest(before) || !digest(after)) {
    diagnostics.push("data_frame_source_hash_invalid");
  }
  if (
    !Array.isArray(required) ||
    required.length < 2 ||
    required.length > 8 ||
    !required.every(validDataFrameEvidenceExpectation)
  ) {
    diagnostics.push("data_frame_required_evidence_invalid");
  }
  return diagnostics;
}

export function validWorkflowBenchmarkDataFrameEvidenceBinding(
  bundle: WorkflowBenchmarkLedgerBundle,
): boolean {
  const events = bundle.workflow.dataFrameActionEvents;
  const before = bundle.workflow.dataSourceBeforeSha256;
  const after = bundle.workflow.dataSourceAfterSha256;
  const required = bundle.workflow.requiredDataFrameEvidence;
  if (!events && !before && !after && !required) return true;
  if (!events || !before || !after || !required) return false;
  const mapRunIds = new Set(bundle.workflow.mapRunIds);
  return (
    eventsRespectOrder(events, mapRunIds) &&
    events.every(
      (event) =>
        dataFrameEventSourceSha256(event) === before &&
        receiptMatchesEvent(bundle.eventReceipts, event),
    )
  );
}

function dataFrameActionEventDiagnostics(value: unknown): string[] {
  const diagnostics: string[] = [];
  if (!hasExactRunEventEnvelope(value)) {
    return ["envelope_invalid"];
  }
  const payload = record(value["payload"]) ? value["payload"] : {};
  const expectedPayloadKeys =
    payload["toolName"] === "inspect_data"
      ? INSPECT_PAYLOAD_KEYS
      : PAYLOAD_KEYS;
  if (!exactRecord(value["payload"], expectedPayloadKeys)) {
    const observed = Object.keys(payload);
    return [
      "payload_fields_invalid",
      ...expectedPayloadKeys
        .filter((key) => !observed.includes(key))
        .map((key) => `payload_missing_${key}`),
      ...observed
        .filter((key) => !expectedPayloadKeys.includes(key))
        .map((key) => `payload_extra_${key}`),
    ];
  }
  const event = value as unknown as RunEvent;
  const action = workflowBenchmarkDataFrameAction(event);
  const details = record(value["payload"]["details"])
    ? value["payload"]["details"]
    : {};
  if (
    !(
      resourceId(value["id"]) &&
      resourceId(value["threadId"]) &&
      resourceId(value["runId"]) &&
      nonNegativeInteger(value["seq"]) &&
      value["type"] === "tool.completed" &&
      value["category"] === "tool" &&
      value["visibility"] === "user" &&
      validIsoDate(value["createdAt"])
    )
  ) {
    diagnostics.push("identity_invalid");
  }
  if (!validToolPayload(value["payload"], action)) {
    diagnostics.push("payload_invalid");
  }
  if (
    action === "inspect_data"
      ? !validInspectDetails(details)
      : action === "data_frame"
        ? !validDataFrameDetails(details)
        : true
  ) {
    diagnostics.push("details_invalid");
  }
  return diagnostics;
}

function validToolPayload(
  payload: Record<string, unknown>,
  action: WorkflowBenchmarkDataFrameAction | undefined,
): boolean {
  return (
    boundedString(payload["callId"], 1, 200) &&
    (payload["toolName"] === "inspect_data" ||
      payload["toolName"] === "data_frame") &&
    payload["status"] === "completed" &&
    digest(payload["outputTextSha256"]) &&
    nonNegativeInteger(payload["outputTextBytes"]) &&
    digest(payload["outputSha256"]) &&
    nonNegativeInteger(payload["outputBytes"]) &&
    payload["outputRedacted"] === true &&
    record(payload["details"]) !== undefined &&
    (action === "inspect_data" ||
      (digest(payload["resultSha256"]) &&
        payload["resultSha256"] ===
          sha256(canonicalJson(payload["details"] as JsonValue))))
  );
}

function validInspectDetails(details: Record<string, unknown>): boolean {
  return (
    exactRecord(details, INSPECT_DETAILS_KEYS) &&
    digest(details["pathSha256"]) &&
    ["json", "jsonl", "csv", "tsv", "markdown_table"].includes(
      String(details["format"]),
    ) &&
    digest(details["sha256"]) &&
    boundedInteger(details["sizeBytes"], 0, 2 * 1024 * 1024) &&
    boundedInteger(details["rowCount"], 0, 1_000_000) &&
    boundedInteger(details["columnCount"], 0, 1_000) &&
    typeof details["truncated"] === "boolean" &&
    digest(details["columnSetSha256"]) &&
    digest(details["sampleSha256"])
  );
}

function validDataFrameDetails(details: Record<string, unknown>): boolean {
  return (
    exactRecord(details, DATA_FRAME_DETAILS_KEYS) &&
    details["kind"] === "napier.data-frame" &&
    details["schemaVersion"] === 1 &&
    details["action"] === "transform" &&
    digest(details["sourcePathSha256"]) &&
    digest(details["sourceSha256"]) &&
    boundedInteger(details["sourceBytes"], 0, 2 * 1024 * 1024) &&
    ["json", "jsonl", "csv", "tsv", "markdown_table"].includes(
      String(details["sourceFormat"]),
    ) &&
    boundedInteger(details["sourceRowCount"], 0, 10_000) &&
    boundedInteger(details["sourceColumnCount"], 0, 80) &&
    boundedInteger(details["operationCount"], 1, 12) &&
    digest(details["planSha256"]) &&
    boundedInteger(details["rowCount"], 0, 1_000) &&
    boundedInteger(details["columnCount"], 0, 80) &&
    [
      "columnsSha256",
      "rowsSha256",
      "outputSha256",
      "parserSha256",
      "engineSha256",
      "limitsSha256",
      "resultSha256",
    ].every((key) => digest(details[key])) &&
    boundedInteger(details["outputBytes"], 1, 256 * 1024)
  );
}

function validDataFrameEvidenceExpectation(value: unknown): boolean {
  return (
    exactRecord(value, ["rowsSha256", "rowCount", "columnCount"]) &&
    digest(value["rowsSha256"]) &&
    boundedInteger(value["rowCount"], 0, 1_000) &&
    boundedInteger(value["columnCount"], 0, 80)
  );
}

function eventsRespectOrder(
  events: RunEvent[],
  mapRunIds: ReadonlySet<string>,
): boolean {
  return (
    new Set(events.map((event) => event.id)).size === events.length &&
    events.every(
      (event, index) =>
        mapRunIds.has(event.runId) &&
        (index === 0 || event.seq > events[index - 1]!.seq),
    )
  );
}

function inspectionBindsDataFrame(
  inspection: RunEvent,
  dataFrame: RunEvent,
  sourceSha256: string,
): boolean {
  const inspected = eventDetails(inspection);
  const transformed = eventDetails(dataFrame);
  return (
    inspected["sha256"] === sourceSha256 &&
    transformed["sourceSha256"] === sourceSha256 &&
    inspected["truncated"] === false &&
    inspected["pathSha256"] === transformed["sourcePathSha256"] &&
    inspected["format"] === transformed["sourceFormat"] &&
    inspected["sizeBytes"] === transformed["sourceBytes"] &&
    inspected["rowCount"] === transformed["sourceRowCount"] &&
    inspected["columnCount"] === transformed["sourceColumnCount"]
  );
}

function dataFrameEventSourceSha256(event: RunEvent): string | undefined {
  const details = eventDetails(event);
  const value =
    workflowBenchmarkDataFrameAction(event) === "inspect_data"
      ? details["sha256"]
      : details["sourceSha256"];
  return typeof value === "string" ? value : undefined;
}

function eventDetails(event: RunEvent): Record<string, unknown> {
  const payload = record(event.payload) ? event.payload : {};
  return record(payload["details"]) ? payload["details"] : {};
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

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  );
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
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
