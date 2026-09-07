import type { JsonObject, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationNetworkActivities,
  conversationNetworkActivity,
} from "../src/conversation-network-activity-view-model";

describe("Conversation network activities", () => {
  it("collapses search lifecycle by call ID and projects provider fallback counts", () => {
    const activities = conversationNetworkActivities([
      event(1, "tool.started", {
        callId: "call_search",
        toolName: "web_search",
        status: "started",
        inputSha256: "a".repeat(64),
      }),
      event(2, "tool.completed", {
        callId: "call_search",
        toolName: "web_search",
        status: "completed",
        output: "PRIVATE_RESULTS",
        details: searchDetails(),
      }),
    ]);

    expect(activities).toEqual([
      {
        kind: "search",
        id: "event_2",
        callId: "call_search",
        seq: 2,
        createdAt: "2026-08-08T00:00:02.000Z",
        status: "completed",
        provider: "duckduckgo",
        category: "general",
        resultCount: 3,
        attemptedProviderCount: 3,
        failedProviderCount: 1,
        unavailableProviderCount: 1,
        retrievedAt: "2026-08-08T00:00:01.000Z",
      },
    ]);
    expect(JSON.stringify(activities)).not.toContain("PRIVATE_RESULTS");
    expect(JSON.stringify(activities)).not.toContain("PRIVATE_QUERY");
  });

  it("accepts older search receipts and keeps zero results distinct from missing evidence", () => {
    const details: JsonObject = {
      ...searchDetails(),
      resultCount: 0,
    };
    for (const key of [
      "operationJournalVersion",
      "operationCount",
      "settledOperationCount",
      "operationSetSha256",
    ])
      delete details[key];
    expect(
      conversationNetworkActivity(
        event(3, "tool.completed", {
          callId: "call_search",
          toolName: "web_search",
          details,
        }),
      ),
    ).toMatchObject({
      status: "completed",
      resultCount: 0,
      provider: "duckduckgo",
    });
  });

  it("projects fetch format, size shape, and Browser fallback recovery", () => {
    expect(
      conversationNetworkActivity(
        event(3, "tool.completed", {
          callId: "call_fetch",
          toolName: "web_fetch",
          status: "completed",
          sourceUrl: "https://private.example/report.pdf",
          sourceBody: "PRIVATE_FETCH_BODY",
          details: fetchDetails(),
        }),
      ),
    ).toEqual({
      kind: "fetch",
      id: "event_3",
      callId: "call_fetch",
      seq: 3,
      createdAt: "2026-08-08T00:00:03.000Z",
      status: "completed",
      action: "fetch",
      sourceCount: 1,
      format: "html",
      lineCount: 42,
      renderMode: "browser_fallback",
      fallbackStatus: "used",
      redirectCount: 1,
      retrievedAt: "2026-08-08T00:00:02.000Z",
    });
  });

  it("keeps image search page candidates distinct from direct image results", () => {
    const activity = conversationNetworkActivity(
      event(3, "tool.completed", {
        callId: "call_images",
        toolName: "web_search",
        details: {
          ...searchDetails(),
          provider: "firecrawl",
          category: "images",
          resolvedCategory: "general",
          resolutionMode: "image_page_candidates",
          resultCount: 15,
        },
      }),
    );
    expect(activity).toMatchObject({
      status: "completed",
      provider: "firecrawl",
      resultCount: 15,
      category: "images",
      resolutionMode: "image_page_candidates",
    });
  });

  it("projects successfully fetched image evidence", () => {
    expect(
      conversationNetworkActivity(
        event(3, "tool.completed", {
          callId: "call_image",
          toolName: "web_fetch",
          details: fetchDetails({
            sourceFormat: "image",
            sourceLineCount: 1,
            sourceRenderMode: "static",
            browserFallbackStatus: "not_needed",
          }),
        }),
      ),
    ).toMatchObject({
      status: "completed",
      action: "fetch",
      format: "image",
      lineCount: 1,
    });
  });

  it("retains the requested action and typed timeout without reading private errors", () => {
    const activities = conversationNetworkActivities([
      event(1, "tool.started", {
        callId: "call_timeout",
        toolName: "web_fetch",
        action: "fetch",
      }),
      event(2, "tool.failed", {
        callId: "call_timeout",
        toolName: "web_fetch",
        details: {
          kind: "napier.web-fetch",
          schemaVersion: 1,
          action: "unknown",
        },
        error: "PRIVATE_NETWORK_ERROR",
        toolFailure: failureReceipt(),
      }),
    ]);
    expect(activities).toEqual([
      expect.objectContaining({
        status: "failed",
        action: "fetch",
        failureClass: "timeout",
      }),
    ]);
    expect(JSON.stringify(activities)).not.toContain("PRIVATE");
  });

  it("explains circuit rejection from operation receipts, scoped to the same run and call", () => {
    const rejected = event(2, "tool.operation.admitted", {
      kind: "napier.tool-operation",
      schemaVersion: 1,
      parentCallId: "call_fetch",
      admission: "rejected",
      admissionSource: "failure_circuit",
      circuitStatus: "open",
      circuitKeySha256: "a".repeat(64),
      circuitPolicySha256: "b".repeat(64),
    });
    const failed = event(3, "tool.failed", {
      callId: "call_fetch",
      toolName: "web_fetch",
      toolFailure: failureReceipt({
        class: "policy",
        scope: "invocation",
        disposition: "terminal",
      }),
    });
    const activities = conversationNetworkActivities([
      rejected,
      failed,
      { ...failed, id: "other_run_failure", runId: "run_2", seq: 4 },
    ]);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toMatchObject({ failureClass: "circuit_open" });
    expect(activities[1]).toMatchObject({ failureClass: "policy" });
    const recovered = conversationNetworkActivities([
      rejected,
      failed,
      event(4, "tool.completed", {
        callId: "call_fetch",
        toolName: "web_fetch",
        details: fetchDetails(),
      }),
    ]);
    expect(recovered[0]).toMatchObject({ status: "completed" });
    expect(recovered[0]).not.toHaveProperty("failureClass");
  });

  it.each([
    { operationSetSha256: "invalid" },
    { settledOperationCount: 2 },
    { resolutionMode: "image_page_candidates" },
    { resolvedCategory: "general", resolutionMode: "PRIVATE_MODE" },
  ])("rejects malformed search extensions: %j", (overrides) => {
    expect(
      conversationNetworkActivity(
        event(3, "tool.completed", {
          callId: "call_search",
          toolName: "web_search",
          details: { ...searchDetails(), ...overrides },
        }),
      ),
    ).not.toHaveProperty("resultCount");
  });

  it.each([
    { class: "PRIVATE_CLASS" },
    { schemaVersion: 2 },
    { coverage: "invalid_declared" },
    { diagnosticSha256: "invalid" },
  ])("keeps an unrecognized failure generic: %j", (overrides) => {
    expect(
      conversationNetworkActivity(
        event(3, "tool.failed", {
          callId: "call_fetch",
          toolName: "web_fetch",
          toolFailure: failureReceipt(overrides),
        }),
      ),
    ).not.toHaveProperty("failureClass");
  });

  it("fails closed on private or malformed receipts but preserves terminal status", () => {
    const malformedSearch = event(4, "tool.completed", {
      callId: "call_search",
      toolName: "web_search",
      status: "completed",
      details: {
        ...searchDetails(),
        query: "PRIVATE_QUERY",
      },
    });
    const unavailableFetch = event(5, "tool.completed", {
      callId: "call_fetch",
      toolName: "web_fetch",
      status: "completed",
      details: {
        ...fetchDetails({
          sourceRenderMode: "static",
          browserFallbackStatus: "unavailable",
          browserFallbackDiagnostic: "login_required",
        }),
      },
    });
    const failed = event(6, "tool.failed", {
      callId: "call_failed",
      toolName: "web_fetch",
      status: "failed",
      action: "fetch",
      error: "PRIVATE_NETWORK_ERROR",
    });

    expect(conversationNetworkActivity(malformedSearch)).toEqual({
      kind: "search",
      id: "event_4",
      callId: "call_search",
      seq: 4,
      createdAt: "2026-08-08T00:00:04.000Z",
      status: "completed",
    });
    expect(conversationNetworkActivity(unavailableFetch)).toEqual(
      expect.objectContaining({
        kind: "fetch",
        status: "completed",
        fallbackStatus: "unavailable",
        fallbackDiagnostic: "login_required",
      }),
    );
    expect(conversationNetworkActivity(failed)).toEqual({
      kind: "fetch",
      id: "event_6",
      callId: "call_failed",
      seq: 6,
      createdAt: "2026-08-08T00:00:06.000Z",
      status: "failed",
      action: "fetch",
    });
    expect(
      JSON.stringify([
        conversationNetworkActivity(malformedSearch),
        conversationNetworkActivity(unavailableFetch),
        conversationNetworkActivity(failed),
      ]),
    ).not.toContain("PRIVATE");
  });
});

function searchDetails() {
  return {
    kind: "napier.web-search",
    schemaVersion: 1,
    provider: "duckduckgo",
    category: "general",
    resultCount: 3,
    attemptedProviderCount: 3,
    failedProviderCount: 1,
    unavailableProviderCount: 1,
    querySha256: "a".repeat(64),
    resultSetSha256: "b".repeat(64),
    retrievedAt: "2026-08-08T00:00:01.000Z",
    operationJournalVersion: 1,
    operationCount: 1,
    settledOperationCount: 1,
    operationSetSha256: "c".repeat(64),
  };
}

function failureReceipt(overrides: Record<string, unknown> = {}) {
  return {
    kind: "napier.tool-failure-semantics",
    schemaVersion: 1,
    class: "timeout",
    scope: "origin",
    disposition: "alternate_route",
    fatalToSession: false,
    coverage: "trusted_declared",
    modeId: "origin_timeout",
    failureDefinitionSha256: "a".repeat(64),
    bindingSha256: "b".repeat(64),
    diagnosticSha256: "c".repeat(64),
    ...overrides,
  };
}

function fetchDetails(overrides: Record<string, unknown> = {}) {
  return {
    kind: "napier.web-fetch",
    schemaVersion: 1,
    action: "fetch",
    sourceIdSha256: "0".repeat(64),
    sourceFormat: "html",
    sourceContentSha256: "1".repeat(64),
    sourceUrlSha256: "2".repeat(64),
    sourceOriginSha256: "3".repeat(64),
    sourceTitleSha256: "4".repeat(64),
    sourceBodySha256: "5".repeat(64),
    sourceBodyBytes: 4_096,
    sourceLineCount: 42,
    sourceTextChars: 2_000,
    sourceTruncated: false,
    sourceRenderMode: "browser_fallback",
    browserFallbackStatus: "used",
    browserSessionIdSha256: "6".repeat(64),
    browserActiveTabId: "tab_1",
    browserTabSetSha256: "7".repeat(64),
    browserExecutableSha256: "8".repeat(64),
    browserVersionSha256: "9".repeat(64),
    browserLimitsSha256: "a".repeat(64),
    browserNetworkDestinationsSha256: "b".repeat(64),
    browserFallbackCount: 1,
    browserSessionOperation: 2,
    browserTabCount: 1,
    browserNetworkRequestCount: 2,
    browserNetworkConnectCount: 1,
    browserNetworkRejectedCount: 0,
    browserNetworkTransferredBytes: 4_096,
    browserNetworkDestinationCount: 1,
    redirectCount: 1,
    sourceCount: 1,
    sourceSetSha256: "c".repeat(64),
    retrievedAt: "2026-08-08T00:00:02.000Z",
    ...overrides,
  };
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
