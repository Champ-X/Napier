import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import type { BrowserPageSourceCapture } from "../src/browser-session.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { AppendEventInput } from "../src/run-event-registry.js";
import { resolveRegisteredEventInput } from "../src/run-event-registry.js";
import { ConcurrentRunEventHeadError } from "../src/sqlite-ledger-errors.js";
import {
  DurableToolOperationJournal,
  projectSettledToolOperationProgress,
  type ToolOperationAdmissionDecision,
  type ToolOperationObserver,
  type ToolOperationJournalStore,
} from "../src/tool-operation-journal.js";
import { executeWebFetchSource } from "../src/web-fetch-execution.js";
import { resolveWebFetchRequestFailureBrowserFallback } from "../src/web-fetch-fallback-execution.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";
import { createWebFetchTool } from "../src/web-fetch-tool.js";

const OWNER = {
  threadId: "thread_fetch_operation_journal",
  runId: "run_fetch_operation_journal",
};

describe("Web Fetch operation journal", () => {
  it("does not consume fallback quota when durable admission is unavailable", async () => {
    const reserveBrowserFallback = vi.fn(async () => 1);
    const captureUrl = vi.fn(async () => browserCapture());
    const unavailable: ToolOperationAdmissionDecision = {
      admitted: false,
      source: "replay",
      disposition: "in_flight_replay",
    };
    const operations: ToolOperationObserver = {
      operation: () => ({
        operationId: "operation_contended_browser",
        proposed: vi.fn(async () => undefined),
        preflight: vi.fn(async () => ({
          admitted: true,
          source: "caller" as const,
          disposition: "execute" as const,
        })),
        admit: vi.fn(async () => unavailable),
        started: vi.fn(async () => undefined),
        settled: vi.fn(async () => undefined),
      }),
    };

    await expect(
      resolveWebFetchRequestFailureBrowserFallback({
        browserFallback: { captureUrl },
        browserFallbackCount: 0,
        reserveBrowserFallback,
        owner: OWNER,
        url: "https://example.com/protected",
        signal: new AbortController().signal,
        allowed: true,
        operations,
        operationOrdinal: 2,
      }),
    ).resolves.toBeUndefined();

    expect(reserveBrowserFallback).not.toHaveBeenCalled();
    expect(captureUrl).not.toHaveBeenCalled();
  });

  it("preserves an HTTP failure and Browser fallback success as two child attempts", async () => {
    const events: RunEvent[] = [];
    const store = memoryStore(events);
    const browserFallback = {
      captureUrl: vi.fn(async () => browserCapture()),
    };
    const manager = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(async () => ({
          status: 403,
          headers: { "content-type": "text/plain" },
          body: Buffer.from("private forbidden body"),
          finalUrl: "https://example.com/protected",
          redirectCount: 0,
        })),
      },
      browserFallback,
    });
    const tool = createWebFetchTool(
      manager,
      OWNER,
      { browserFallbackAllowed: true },
      { store, owner: OWNER },
    );

    const result = await tool.execute("call_fetch_fallback", {
      action: "fetch",
      url: "https://example.com/protected?private=value",
    });

    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Browser rendered public evidence"),
      }),
    );
    expect(browserFallback.captureUrl).toHaveBeenCalledOnce();
    const operationEvents = events.filter((event) =>
      event.type.startsWith("tool.operation."),
    );
    expect(operationEvents.map((event) => event.type)).toEqual([
      "tool.operation.proposed",
      "tool.operation.admitted",
      "tool.operation.started",
      "tool.operation.settled",
      "tool.operation.proposed",
      "tool.operation.admitted",
      "tool.operation.started",
      "tool.operation.settled",
    ]);
    expect(
      operationEvents
        .filter((event) => event.type === "tool.operation.settled")
        .map((event) => field(event, "outcome")),
    ).toEqual(["failed", "succeeded"]);
    expect(
      operationEvents
        .filter((event) => event.type === "tool.operation.proposed")
        .map((event) => field(event, "route")),
    ).toEqual(["static_http", "browser_render"]);
    const progress = projectSettledToolOperationProgress(operationEvents);
    expect(progress.suppressParentSingletonCallIds).toEqual([
      "call_fetch_fallback",
    ]);
    expect(progress.observations).toEqual([
      expect.objectContaining({
        ordinal: 1,
        outcome: "failed",
        acquisitionAttempt: true,
        acquisitionAdvance: false,
      }),
      expect.objectContaining({
        ordinal: 2,
        outcome: "succeeded",
        acquisitionAttempt: true,
        acquisitionAdvance: true,
      }),
    ]);
    const durable = JSON.stringify(operationEvents);
    expect(durable).not.toContain("private=value");
    expect(durable).not.toContain("private forbidden body");
    expect(durable).not.toContain("Browser rendered public evidence");
  });

  it("records URL policy rejection without inventing a network attempt", async () => {
    const events: RunEvent[] = [];
    const store = memoryStore(events);
    const http = { request: vi.fn() };
    const tool = createWebFetchTool(
      new RunWebFetchSourceManager({ http }),
      OWNER,
      {},
      { store, owner: OWNER },
    );

    await expect(
      tool.execute("call_fetch_rejected", {
        action: "fetch",
        url: "file:///private/source",
      }),
    ).rejects.toThrow("Only HTTP(S) URLs are allowed");

    expect(http.request).not.toHaveBeenCalled();
    const progress = projectSettledToolOperationProgress(events);
    expect(progress.suppressParentSingletonCallIds).toEqual([
      "call_fetch_rejected",
    ]);
    expect(progress.observations).toEqual([
      expect.objectContaining({
        admission: "rejected",
        outcome: "skipped",
        acquisitionAttempt: false,
        acquisitionAdvance: false,
      }),
    ]);
  });

  it("skips an open static route on the next call and uses the legal browser alternative", async () => {
    const events: RunEvent[] = [];
    const store = memoryStore(events);
    const http = {
      request: vi.fn(async () => ({
        status: 403,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("forbidden"),
        finalUrl: "https://example.com/protected",
        redirectCount: 0,
      })),
    };
    const browserFallback = {
      captureUrl: vi.fn(async () => browserCapture()),
    };
    const tool = createWebFetchTool(
      new RunWebFetchSourceManager({ http, browserFallback }),
      OWNER,
      { browserFallbackAllowed: true },
      { store, owner: OWNER },
    );

    await tool.execute("call_fetch_first", {
      action: "fetch",
      url: "https://example.com/protected",
    });
    await tool.execute("call_fetch_second", {
      action: "fetch",
      url: "https://example.com/protected",
    });

    expect(http.request).toHaveBeenCalledOnce();
    expect(browserFallback.captureUrl).toHaveBeenCalledTimes(2);
    const secondStaticAdmission = events.find(
      (event) =>
        event.type === "tool.operation.admitted" &&
        field(event, "parentCallId") === "call_fetch_second" &&
        field(event, "route") === "static_http",
    );
    expect(secondStaticAdmission).toBeDefined();
    expect(field(secondStaticAdmission!, "admission")).toBe("rejected");
    expect(field(secondStaticAdmission!, "admissionSource")).toBe(
      "failure_circuit",
    );
    expect(field(secondStaticAdmission!, "circuitScope")).toBe("route");
    const progress = projectSettledToolOperationProgress(events);
    expect(
      progress.observations.find(
        (observation) =>
          observation.parentCallId === "call_fetch_second" &&
          observation.route === "static_http",
      ),
    ).toEqual(
      expect.objectContaining({
        admissionSource: "failure_circuit",
        acquisitionAttempt: false,
        acquisitionFailure: false,
        failureObserved: false,
      }),
    );
  });

  it("shares an origin circuit across the built-in static and Browser routes", async () => {
    const events: RunEvent[] = [];
    const journal = new DurableToolOperationJournal(
      memoryStore(events),
      OWNER,
      {
        now: () => "2026-09-03T12:00:10.000Z",
      },
    );
    const transportAbort = new Error("The operation was aborted");
    transportAbort.name = "AbortError";
    const http = {
      request: vi.fn(async () => {
        throw transportAbort;
      }),
    };
    const browserCaptureUrl = vi.fn(async () => browserCapture());
    const signal = new AbortController().signal;
    const execute = (callId: string, browserFallbackAllowed: boolean) =>
      executeWebFetchSource({
        http,
        browserFallback: {
          captureUrl: browserCaptureUrl,
        },
        browserFallbackCount: 0,
        owner: OWNER,
        url: "https://example.com/same-origin",
        signal,
        options: { browserFallbackAllowed },
        now: () => new Date("2026-09-03T12:00:00.000Z"),
        operations: journal.observer(callId),
      });
    await expect(execute("call_origin_one", false)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await expect(execute("call_origin_two", false)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    await expect(execute("call_origin_three", true)).rejects.toThrow(
      /failure circuit is open/iu,
    );

    expect(http.request).toHaveBeenCalledTimes(2);
    expect(browserCaptureUrl).not.toHaveBeenCalled();
    const rejectedRoutes = events
      .filter(
        (event) =>
          event.type === "tool.operation.admitted" &&
          field(event, "parentCallId") === "call_origin_three",
      )
      .map((event) => [field(event, "route"), field(event, "circuitScope")]);
    expect(rejectedRoutes).toEqual([
      ["static_http", "origin"],
      ["browser_render", "origin"],
    ]);
  });
});

function browserCapture(): BrowserPageSourceCapture {
  const url = "https://example.com/protected";
  const title = "Protected Source";
  const lines = [
    "Protected Source",
    "Browser rendered public evidence after the static route was denied.",
    "A second complete sentence keeps the bounded capture useful.",
  ];
  return {
    url,
    title,
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: sha256(canonicalJson([])),
      takeoverRecommended: false,
    },
    semanticAppControlCount: 0,
    lines,
    textChars: lines.join("\n").length,
    truncated: false,
    capturedContentSha256: sha256(
      canonicalJson({ url, title, lines, truncated: false }),
    ),
    sessionOperation: 1,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    network: {
      requestCount: 2,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 1_024,
      destinationCount: 1,
      destinationsSha256: "5".repeat(64),
    },
  };
}

function field(event: RunEvent, name: string): JsonValue | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
    ? event.payload[name]
    : undefined;
}

function memoryStore(events: RunEvent[]): ToolOperationJournalStore {
  const idempotent = new Map<string, RunEvent>();
  const appendEvent = async (input: AppendEventInput) => {
    const resolved = resolveRegisteredEventInput(input);
    const event: RunEvent = {
      id: `event_${String(events.length + 1)}`,
      threadId: input.threadId,
      runId: input.runId,
      seq: events.length + 1,
      type: resolved.type,
      category: resolved.category,
      visibility: resolved.visibility,
      createdAt: "2026-09-03T12:00:00.000Z",
      payload: resolved.payload,
      schemaVersion: resolved.schemaVersion,
    };
    events.push(event);
    return structuredClone(event);
  };
  return {
    appendEvent,
    async appendEventOnceAtRunHead(input, options) {
      const key = `${input.runId}:${options.namespace}:${options.key}`;
      const existing = idempotent.get(key);
      if (existing) {
        return { event: structuredClone(existing), appended: false };
      }
      const actualRunHeadSeq = events
        .filter((event) => event.runId === input.runId)
        .reduce((head, event) => Math.max(head, event.seq), 0);
      if (actualRunHeadSeq !== options.expectedRunHeadSeq) {
        throw new ConcurrentRunEventHeadError(
          input.runId,
          options.expectedRunHeadSeq,
          actualRunHeadSeq,
        );
      }
      const event = await appendEvent(input);
      idempotent.set(key, structuredClone(event));
      return { event, appended: true };
    },
    async listRunEvents(runId, afterSeq = 0, types) {
      return events
        .filter(
          (event) =>
            event.runId === runId &&
            event.seq > afterSeq &&
            (!types || types.includes(event.type)),
        )
        .map((event) => structuredClone(event));
    },
  };
}
