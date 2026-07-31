import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  browserEventEvidence,
  browserSummaryParts,
} from "../src/browser-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Browser Trace projection", () => {
  it("projects bounded Session, network, and file evidence", () => {
    const details = browserDetails();
    const view = browserEventEvidence(details);
    expect(view).toEqual(
      expect.objectContaining({
        browserAction: "download",
        browserSessionMode: "run_persistent",
        browserSessionReused: true,
        browserSessionOperation: 4,
        browserSessionIdSha256: "1".repeat(64),
        browserSnapshotChars: 321,
        browserFileBytes: 456,
        browserBlockedRequestCount: 2,
        browserNetworkRequestCount: 12,
        browserNetworkConnectCount: 3,
        browserNetworkRejectedCount: 2,
        browserNetworkTransferredBytes: 98_765,
        browserNetworkDestinationCount: 4,
        browserCrossOriginAuthorized: true,
      }),
    );
    expect(browserSummaryParts(view!)).toContain("browser download");
    expect(browserSummaryParts(view!)).toContain("browser-session-reused");
    expect(browserSummaryParts(view!)).toContain("network-requests 12");
    expect(browserSummaryParts(view!)).toContain("file-bytes 456");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_BROWSER");

    const screenshot = browserEventEvidence({
      ...details,
      action: "screenshot",
      snapshotSha256: undefined,
      snapshotChars: undefined,
      snapshotTruncated: undefined,
      file: undefined,
      suggestedFilenameSha256: undefined,
      screenshotSha256: "9".repeat(64),
      screenshotBytes: 12_345,
    });
    expect(screenshot).toEqual(
      expect.objectContaining({
        browserAction: "screenshot",
        browserScreenshotBytes: 12_345,
      }),
    );
  });

  it("integrates browser evidence into generic tool summaries without raw content", () => {
    const event: RunEvent = {
      id: "event_browser",
      threadId: "thread_browser",
      runId: "run_browser",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "browser",
        status: "completed",
        effect: "write",
        output: "PRIVATE_BROWSER_PAGE",
        details: browserDetails(),
      },
      createdAt: "2026-07-31T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "browser",
        status: "completed",
        effect: "write",
        browserAction: "download",
        browserSessionOperation: 4,
      }),
    );
    const summary = toolEventTraceSummary(event);
    expect(summary).toContain("tool / browser / completed / effect write");
    expect(summary).toContain("browser download");
    expect(summary).toContain("browser-operation 4");
    expect(summary).not.toContain("PRIVATE_BROWSER");
  });

  it("fails closed on partial or inconsistent Browser evidence", () => {
    expect(
      browserEventEvidence({
        ...browserDetails(),
        sessionReused: false,
      }),
    ).toBeUndefined();
    expect(
      browserEventEvidence({
        ...browserDetails(),
        snapshotSha256: undefined,
      }),
    ).toBeUndefined();
    expect(
      browserEventEvidence({
        ...browserDetails(),
        network: {
          ...browserDetails().network,
          transferredBytes: 999_999_999,
        },
      }),
    ).toBeUndefined();
  });
});

function browserDetails() {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 1,
    action: "download",
    sessionMode: "run_persistent",
    sessionReused: true,
    sessionOperation: 4,
    sessionIdSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    currentUrlSha256: "5".repeat(64),
    currentOriginSha256: "6".repeat(64),
    titleSha256: "7".repeat(64),
    snapshotSha256: "8".repeat(64),
    snapshotChars: 321,
    snapshotTruncated: false,
    file: {
      pathSha256: "a".repeat(64),
      fileSha256: "b".repeat(64),
      fileBytes: 456,
      path: "PRIVATE_BROWSER_PATH",
    },
    suggestedFilenameSha256: "c".repeat(64),
    blockedRequestCount: 2,
    network: {
      requestCount: 12,
      connectCount: 3,
      rejectedCount: 2,
      transferredBytes: 98_765,
      destinationCount: 4,
      destinationsSha256: "d".repeat(64),
      destinations: ["PRIVATE_BROWSER_DESTINATION"],
    },
    crossOriginAuthorized: true,
    snapshot: "PRIVATE_BROWSER_SNAPSHOT",
  };
}
