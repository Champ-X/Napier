import type { RunEvent } from "@napier/contracts";
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
