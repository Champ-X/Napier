import type { JsonValue, RunEvent } from "@napier/contracts";
import {
  parseBrowserInteractionConfirmation,
  type BrowserInteractionConfirmation,
} from "@napier/contracts/browser-interaction-confirmation";
import { canonicalJson, sha256 } from "@napier/runtime";

import type {
  BrowserConfirmedFormBenchmarkLedger,
  BrowserConfirmedFormBenchmarkResult,
  BrowserConfirmedFormEventReceipt,
  BrowserConfirmedFormOperationEvidence,
} from "./browser-confirmed-form-benchmark-types.js";

const EMPTY_SHA256 = sha256("");

export function createBrowserConfirmedFormBenchmarkLedger(input: {
  generatedAt: string;
  caseId: string;
  caseSha256: string;
  threadId: string;
  runId: string;
  model: BrowserConfirmedFormBenchmarkLedger["model"];
  expectedAssistantSha256: string;
  actualAssistantSha256?: string;
  expectedOutcomeUrlSha256: string;
  expectedOutcomeTitleSha256: string;
  expectedConfirmationActions: BrowserConfirmedFormBenchmarkLedger["expectedConfirmationActions"];
  expectedConfirmationEffects: BrowserConfirmedFormBenchmarkLedger["expectedConfirmationEffects"];
  maxDurationMs: number;
  credentialVariableSha256: string;
  run: BrowserConfirmedFormBenchmarkLedger["run"];
  execution: BrowserConfirmedFormBenchmarkLedger["execution"];
  events: RunEvent[];
  sourceEventStreamSha256: string;
  sourceReplaySha256: string;
  replayValid: boolean;
  credentialReferenceCount: number;
  credentialProviderMatch: boolean;
  credentialLocatorMatch: boolean;
  credentialAvailable: boolean;
  credentialLeakDetected: boolean;
  credentialPersistenceLeakDetected: boolean;
  privateValueLeakDetected: boolean;
  evaluationEvent: RunEvent;
  terminalEvent: RunEvent;
}): BrowserConfirmedFormBenchmarkLedger {
  const events = [...input.events].sort((left, right) => left.seq - right.seq);
  const evidenceEvents = browserConfirmedFormEvidenceEvents(events);
  const receipts = createEventReceipts(evidenceEvents);
  const confirmations = evidenceEvents.flatMap((event) => {
    if (!event.type.startsWith("browser.interaction_confirmation.")) return [];
    const confirmation = parseBrowserInteractionConfirmation(event.payload);
    return confirmation ? [confirmation] : [];
  });
  const browserOperations = evidenceEvents.flatMap(
    projectBrowserConfirmedFormOperation,
  );
  const content = {
    kind: "napier.browser-confirmed-form-benchmark-ledger" as const,
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    caseId: input.caseId,
    caseSha256: input.caseSha256,
    threadId: input.threadId,
    runId: input.runId,
    model: structuredClone(input.model),
    expectedAssistantSha256: input.expectedAssistantSha256,
    ...(input.actualAssistantSha256
      ? { actualAssistantSha256: input.actualAssistantSha256 }
      : {}),
    expectedOutcomeUrlSha256: input.expectedOutcomeUrlSha256,
    expectedOutcomeTitleSha256: input.expectedOutcomeTitleSha256,
    expectedConfirmationActions: structuredClone(
      input.expectedConfirmationActions,
    ),
    expectedConfirmationEffects: structuredClone(
      input.expectedConfirmationEffects,
    ),
    maxDurationMs: input.maxDurationMs,
    credentialVariableSha256: input.credentialVariableSha256,
    run: structuredClone(input.run),
    execution: structuredClone(input.execution),
    evidenceEvents: structuredClone(evidenceEvents),
    confirmations,
    browserOperations,
    replayValid: input.replayValid,
    credentialReferenceCount: input.credentialReferenceCount,
    credentialProviderMatch: input.credentialProviderMatch,
    credentialLocatorMatch: input.credentialLocatorMatch,
    credentialAvailable: input.credentialAvailable,
    credentialLeakDetected: input.credentialLeakDetected,
    credentialPersistenceLeakDetected: input.credentialPersistenceLeakDetected,
    privateValueLeakDetected: input.privateValueLeakDetected,
    evaluationEvent: structuredClone(input.evaluationEvent),
    terminalEvent: projectBrowserConfirmedFormLifecycleEvent(
      input.terminalEvent,
    ),
    eventCount: events.length,
    sourceEventStreamSha256: input.sourceEventStreamSha256,
    sourceReplaySha256: input.sourceReplaySha256,
    eventReceipts: receipts,
    receiptSetSha256: sha256(canonicalJson(receipts)),
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function browserConfirmedFormEvidenceEvents(
  events: RunEvent[],
): RunEvent[] {
  return events.flatMap((event) =>
    isEvidenceEvent(event)
      ? [projectBrowserConfirmedFormEvidenceEvent(event)]
      : [],
  );
}

function isEvidenceEvent(event: RunEvent): boolean {
  return (
    event.type.startsWith("browser.interaction_confirmation.") ||
    (["tool.completed", "tool.failed", "tool.blocked"].includes(event.type) &&
      record(event.payload) &&
      event.payload["toolName"] === "browser") ||
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    event.type === "run.interrupted" ||
    event.type === "benchmark.browser.confirmed_form.evaluated"
  );
}

function projectBrowserConfirmedFormEvidenceEvent(event: RunEvent): RunEvent {
  if (
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.blocked"
  ) {
    const operation = projectBrowserConfirmedFormOperation(event)[0];
    return {
      ...event,
      payload: {
        kind: "napier.browser-confirmed-form-operation-event",
        schemaVersion: 1,
        toolName: "browser",
        status: operation?.status ?? "failed",
        action: operation?.action ?? "unknown",
        sourcePayloadSha256: sha256(canonicalJson(event.payload)),
        ...(operation?.sessionOperation !== undefined
          ? { sessionOperation: operation.sessionOperation }
          : {}),
        ...(operation?.sessionIdSha256
          ? { sessionIdSha256: operation.sessionIdSha256 }
          : {}),
        ...(operation?.currentUrlSha256
          ? { currentUrlSha256: operation.currentUrlSha256 }
          : {}),
        ...(operation?.titleSha256
          ? { titleSha256: operation.titleSha256 }
          : {}),
      },
    };
  }
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    event.type === "run.interrupted"
  ) {
    return projectBrowserConfirmedFormLifecycleEvent(event);
  }
  return structuredClone(event);
}

function projectBrowserConfirmedFormLifecycleEvent(event: RunEvent): RunEvent {
  const payload = record(event.payload) ? event.payload : {};
  const status =
    typeof payload["status"] === "string" ? payload["status"] : "unknown";
  return { ...event, payload: { status } };
}

export function createBrowserConfirmedFormBenchmarkResult(
  content: Omit<BrowserConfirmedFormBenchmarkResult, "contentSha256">,
): BrowserConfirmedFormBenchmarkResult {
  return {
    ...structuredClone(content),
    contentSha256: sha256(canonicalJson(content as unknown as JsonValue)),
  };
}

export function browserConfirmedFormResultFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-browser-confirmed-form-benchmark-result-${caseId}-${digest.slice(0, 16)}.json`;
}

export function browserConfirmedFormLedgerFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-browser-confirmed-form-benchmark-ledger-${caseId}-${digest.slice(0, 16)}.json`;
}

export function browserConfirmedFormSeriesFileName(
  caseId: string,
  digest: string,
): string {
  return `napier-browser-confirmed-form-benchmark-series-${caseId}-${digest.slice(0, 16)}.json`;
}

export function browserConfirmedFormEventReceipts(
  events: RunEvent[],
): BrowserConfirmedFormEventReceipt[] {
  return createEventReceipts(events);
}

export function browserConfirmedFormEvidence(events: RunEvent[]): {
  confirmations: BrowserInteractionConfirmation[];
  browserOperations: BrowserConfirmedFormOperationEvidence[];
} {
  return {
    confirmations: events.flatMap((event) => {
      if (!event.type.startsWith("browser.interaction_confirmation.")) {
        return [];
      }
      const confirmation = parseBrowserInteractionConfirmation(event.payload);
      return confirmation ? [confirmation] : [];
    }),
    browserOperations: events.flatMap(projectBrowserConfirmedFormOperation),
  };
}

export function projectBrowserConfirmedFormOperation(
  event: RunEvent,
): BrowserConfirmedFormOperationEvidence[] {
  const payload = record(event.payload) ? event.payload : {};
  if (
    payload["kind"] === "napier.browser-confirmed-form-operation-event" &&
    payload["schemaVersion"] === 1 &&
    payload["toolName"] === "browser" &&
    typeof payload["action"] === "string" &&
    digest(payload["sourcePayloadSha256"])
  ) {
    return [
      {
        eventId: event.id,
        eventSeq: event.seq,
        eventType: event.type as
          | "tool.blocked"
          | "tool.completed"
          | "tool.failed",
        payloadSha256: payload["sourcePayloadSha256"],
        action: payload["action"],
        status:
          payload["status"] === "completed"
            ? "completed"
            : payload["status"] === "blocked"
              ? "blocked"
              : "failed",
        ...(safeInteger(payload["sessionOperation"])
          ? { sessionOperation: payload["sessionOperation"] }
          : {}),
        ...(digest(payload["sessionIdSha256"])
          ? { sessionIdSha256: payload["sessionIdSha256"] }
          : {}),
        ...(digest(payload["currentUrlSha256"])
          ? { currentUrlSha256: payload["currentUrlSha256"] }
          : {}),
        ...(digest(payload["titleSha256"])
          ? { titleSha256: payload["titleSha256"] }
          : {}),
      },
    ];
  }
  if (
    payload["toolName"] !== "browser" ||
    !["tool.completed", "tool.failed", "tool.blocked"].includes(event.type)
  ) {
    return [];
  }
  const details = record(payload["details"]) ? payload["details"] : {};
  const action =
    string(details["action"]) || string(payload["action"]) || "unknown";
  const status =
    event.type === "tool.completed"
      ? ("completed" as const)
      : event.type === "tool.failed"
        ? ("failed" as const)
        : ("blocked" as const);
  return [
    {
      eventId: event.id,
      eventSeq: event.seq,
      eventType: event.type as
        | "tool.blocked"
        | "tool.completed"
        | "tool.failed",
      payloadSha256: sha256(canonicalJson(event.payload)),
      action,
      status,
      ...(safeInteger(details["sessionOperation"])
        ? { sessionOperation: details["sessionOperation"] }
        : {}),
      ...(digest(details["sessionIdSha256"])
        ? { sessionIdSha256: details["sessionIdSha256"] }
        : {}),
      ...(digest(details["currentUrlSha256"])
        ? { currentUrlSha256: details["currentUrlSha256"] }
        : {}),
      ...(digest(details["titleSha256"])
        ? { titleSha256: details["titleSha256"] }
        : {}),
    },
  ];
}

function createEventReceipts(
  events: RunEvent[],
): BrowserConfirmedFormEventReceipt[] {
  let previousReceiptSha256 = EMPTY_SHA256;
  return events.map((event) => {
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function safeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function strictConfirmationProjection(
  value: unknown,
): BrowserInteractionConfirmation | undefined {
  return parseBrowserInteractionConfirmation(value);
}
