import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationBrowserActivities,
  conversationBrowserActivity,
} from "../src/conversation-browser-activity-view-model";

describe("Conversation Browser activities", () => {
  it("collapses Browser lifecycle and projects safe session evidence", () => {
    const activities = conversationBrowserActivities([
      event(1, "tool.started", {
        callId: "call_browser",
        toolName: "browser",
        status: "started",
        action: "navigate",
      }),
      event(2, "tool.completed", {
        callId: "call_browser",
        toolName: "browser",
        status: "completed",
        output: "PRIVATE_BROWSER_PAGE",
        details: browserDetails(),
      }),
    ]);

    expect(activities).toEqual([
      {
        id: "event_2",
        callId: "call_browser",
        seq: 2,
        createdAt: "2026-08-08T00:00:02.000Z",
        status: "completed",
        action: "navigate",
        operation: 2,
        sessionReused: true,
        activeTabId: "tab_2",
        tabCount: 2,
        pageDiagnosis: "login_required",
        takeoverRecommended: true,
        blockedRequestCount: 1,
        networkRequestCount: 8,
        networkRejectedCount: 1,
        networkTransferredBytes: 8_192,
        destinationCount: 2,
        snapshotChars: 321,
      },
    ]);
    expect(JSON.stringify(activities)).not.toContain("PRIVATE_BROWSER");
  });

  it("projects screenshot and download evidence without paths or bytes", () => {
    const screenshot = conversationBrowserActivity(
      event(3, "tool.completed", {
        callId: "call_screenshot",
        toolName: "browser",
        status: "completed",
        action: "screenshot",
        details: browserDetails({
          action: "screenshot",
          sessionOperation: 3,
          snapshotSha256: undefined,
          snapshotChars: undefined,
          snapshotTruncated: undefined,
          pageDiagnosis: diagnosis("none"),
          screenshotSha256: "e".repeat(64),
          screenshotBytes: 12_345,
        }),
      }),
    );
    const download = conversationBrowserActivity(
      event(4, "tool.completed", {
        callId: "call_download",
        toolName: "browser",
        status: "completed",
        action: "download",
        details: browserDetails({
          action: "download",
          sessionOperation: 4,
          pageDiagnosis: diagnosis("none"),
          file: {
            pathSha256: "a".repeat(64),
            fileSha256: "b".repeat(64),
            fileBytes: 456,
            path: "PRIVATE_BROWSER_PATH",
          },
          suggestedFilenameSha256: "c".repeat(64),
        }),
      }),
    );

    expect(screenshot).toEqual(
      expect.objectContaining({
        action: "screenshot",
        screenshotBytes: 12_345,
      }),
    );
    expect(download).toEqual(
      expect.objectContaining({ action: "download", fileBytes: 456 }),
    );
    expect(JSON.stringify(download)).not.toContain("PRIVATE_BROWSER_PATH");
  });

  it("preserves working and failed terminal states when receipts are absent", () => {
    expect(
      conversationBrowserActivity(
        event(5, "tool.started", {
          callId: "call_working",
          toolName: "browser",
          status: "started",
          action: "snapshot",
          url: "https://private.example",
        }),
      ),
    ).toEqual({
      id: "event_5",
      callId: "call_working",
      seq: 5,
      createdAt: "2026-08-08T00:00:05.000Z",
      status: "working",
      action: "snapshot",
    });
    expect(
      conversationBrowserActivity(
        event(6, "tool.failed", {
          callId: "call_failed",
          toolName: "browser",
          status: "failed",
          action: "navigate",
          error: "PRIVATE_BROWSER_ERROR",
        }),
      ),
    ).toEqual({
      id: "event_6",
      callId: "call_failed",
      seq: 6,
      createdAt: "2026-08-08T00:00:06.000Z",
      status: "failed",
      action: "navigate",
    });
  });

  it("fails closed on malformed Browser receipts", () => {
    const activity = conversationBrowserActivity(
      event(7, "tool.completed", {
        callId: "call_bad",
        toolName: "browser",
        status: "completed",
        action: "navigate",
        details: {
          ...browserDetails(),
          sessionReused: false,
          currentUrl: "https://private.example",
        },
      }),
    );
    expect(activity).toEqual({
      id: "event_7",
      callId: "call_bad",
      seq: 7,
      createdAt: "2026-08-08T00:00:07.000Z",
      status: "completed",
      action: "navigate",
    });
    expect(JSON.stringify(activity)).not.toContain("PRIVATE_BROWSER");
  });
});

function browserDetails(overrides: Record<string, unknown> = {}) {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 3,
    action: "navigate",
    sessionMode: "run_persistent",
    sessionReused: true,
    sessionOperation: 2,
    sessionIdSha256: "1".repeat(64),
    activeTabId: "tab_2",
    tabCount: 2,
    tabSetSha256: "0".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    currentUrlSha256: "5".repeat(64),
    currentOriginSha256: "6".repeat(64),
    titleSha256: "7".repeat(64),
    pageDiagnosis: diagnosis("login_required"),
    snapshotSha256: "8".repeat(64),
    snapshotChars: 321,
    snapshotTruncated: false,
    blockedRequestCount: 1,
    network: {
      requestCount: 8,
      connectCount: 1,
      rejectedCount: 1,
      transferredBytes: 8_192,
      destinationCount: 2,
      destinationsSha256: "d".repeat(64),
      destinations: ["PRIVATE_BROWSER_DESTINATION"],
    },
    crossOriginAuthorized: false,
    ...overrides,
  };
}

function diagnosis(status: "none" | "login_required" | "challenge_detected") {
  return {
    status,
    signalCount: status === "none" ? 0 : 2,
    signalsSha256: "9".repeat(64),
    takeoverRecommended: status !== "none",
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
