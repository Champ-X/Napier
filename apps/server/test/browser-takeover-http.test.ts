import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
} from "@napier/contracts/browser-takeover";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { registerBrowserSessionControlHttp } from "../src/browser-session-control-http.js";
import { parseBrowserTakeoverActionRequest } from "../src/browser-takeover-http-validation.js";

describe("Browser takeover HTTP", () => {
  it("returns no-store snapshot and forwards an exact bounded action", async () => {
    const snapshot = takeoverSnapshot();
    const receipt = takeoverReceipt();
    const controls = {
      snapshot: vi.fn(async () => snapshot),
      executeTakeover: vi.fn(async () => receipt),
    };
    const app = new Hono();
    registerBrowserSessionControlHttp(app, controls as never);
    const path = `/api/threads/${snapshot.threadId}/runs/${snapshot.runId}/browser-session-control/takeover`;

    const snapshotResponse = await app.request(path);
    expect(snapshotResponse.status).toBe(200);
    expect(snapshotResponse.headers.get("cache-control")).toBe("no-store");
    expect(snapshotResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(snapshotResponse.headers.get("x-napier-content-sha256")).toBe(
      snapshot.contentSha256,
    );
    expect(await snapshotResponse.json()).toEqual(snapshot);

    const request = {
      action: "type" as const,
      ref: "e6",
      text: "PRIVATE_OPERATOR_TEXT",
      expectedPauseStateSha256: snapshot.pauseStateSha256,
      expectedSessionIdSha256: snapshot.sessionIdSha256,
      expectedSessionOperation: snapshot.sessionOperation,
      expectedSnapshotSha256: snapshot.snapshotSha256,
      expectedActiveTabId: snapshot.activeTabId,
      expectedTabCount: snapshot.tabCount,
      expectedTabSetSha256: snapshot.tabSetSha256,
    };
    const actionResponse = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(actionResponse.status).toBe(200);
    expect(await actionResponse.json()).toEqual(receipt);
    expect(controls.snapshot).toHaveBeenCalledWith(
      snapshot.threadId,
      snapshot.runId,
      expect.any(AbortSignal),
    );
    expect(controls.executeTakeover).toHaveBeenCalledWith(
      snapshot.threadId,
      snapshot.runId,
      request,
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(receipt)).not.toContain("PRIVATE_OPERATOR_TEXT");
  });

  it("rejects extra fields and oversized private input before Runtime", async () => {
    const controls = { executeTakeover: vi.fn() };
    const app = new Hono();
    registerBrowserSessionControlHttp(app, controls as never);
    const path =
      "/api/threads/thread_takeover/runs/run_takeover/browser-session-control/takeover";
    const binding = {
      expectedPauseStateSha256: "a".repeat(64),
      expectedSessionIdSha256: "b".repeat(64),
      expectedSessionOperation: 1,
      expectedSnapshotSha256: "c".repeat(64),
      expectedActiveTabId: "tab_1",
      expectedTabCount: 1,
      expectedTabSetSha256: "d".repeat(64),
    };

    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "click",
        ref: "e1",
        selector: "#PRIVATE_SELECTOR",
      }),
    ).toBeUndefined();
    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "type",
        ref: "e1",
        text: "x".repeat(8_001),
      }),
    ).toBeUndefined();

    const response = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...binding,
        action: "click",
        ref: "e1",
        extra: "PRIVATE_PAGE_DATA",
      }),
    });
    expect(response.status).toBe(400);
    expect(controls.executeTakeover).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
  });

  it("accepts bounded visual clicks and allowlisted keys only", () => {
    const binding = {
      expectedPauseStateSha256: "a".repeat(64),
      expectedSessionIdSha256: "b".repeat(64),
      expectedSessionOperation: 1,
      expectedSnapshotSha256: "c".repeat(64),
      expectedActiveTabId: "tab_1",
      expectedTabCount: 1,
      expectedTabSetSha256: "d".repeat(64),
    };
    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "visual_click",
        expectedLiveImageSha256: "e".repeat(64),
        expectedViewportWidth: 1_280,
        expectedViewportHeight: 900,
        x: 1_279,
        y: 899,
      }),
    ).toEqual(
      expect.objectContaining({
        action: "visual_click",
        x: 1_279,
        y: 899,
      }),
    );
    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "visual_click",
        expectedLiveImageSha256: "e".repeat(64),
        expectedViewportWidth: 1_280,
        expectedViewportHeight: 900,
        x: 1_280,
        y: 899,
      }),
    ).toBeUndefined();
    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "keypress",
        key: "Shift+Tab",
      }),
    ).toEqual(
      expect.objectContaining({ action: "keypress", key: "Shift+Tab" }),
    );
    expect(
      parseBrowserTakeoverActionRequest({
        ...binding,
        action: "keypress",
        key: "Control+L",
      }),
    ).toBeUndefined();
  });
});

function takeoverSnapshot(): BrowserTakeoverSnapshot {
  return {
    kind: "napier.browser-takeover-snapshot",
    schemaVersion: 2,
    threadId: "thread_takeover",
    runId: "run_takeover",
    pauseStateSha256: "a".repeat(64),
    sessionIdSha256: "b".repeat(64),
    sessionOperation: 2,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "7".repeat(64),
    tabs: [
      {
        tabId: "tab_1",
        active: true,
        url: "https://example.com/",
        currentUrlSha256: "d".repeat(64),
        title: "Example",
        titleSha256: "f".repeat(64),
      },
    ],
    snapshot: '- textbox "Password" [ref=e6]',
    snapshotSha256: "c".repeat(64),
    snapshotChars: 30,
    snapshotTruncated: false,
    currentUrlSha256: "d".repeat(64),
    currentOriginSha256: "e".repeat(64),
    titleSha256: "f".repeat(64),
    capturedAt: "2026-08-05T00:00:00.000Z",
    contentSha256: "1".repeat(64),
  };
}

function takeoverReceipt(): BrowserTakeoverActionReceipt {
  return {
    kind: "napier.browser-takeover-action",
    schemaVersion: 2,
    id: "browser_takeover_12345678",
    threadId: "thread_takeover",
    runId: "run_takeover",
    action: "type",
    status: "completed",
    requestSha256: "2".repeat(64),
    pauseStateSha256: "a".repeat(64),
    sourceSessionIdSha256: "b".repeat(64),
    sourceSessionOperation: 2,
    sourceSnapshotSha256: "c".repeat(64),
    sourceActiveTabId: "tab_1",
    sourceTabCount: 1,
    sourceTabSetSha256: "7".repeat(64),
    targetRefSha256: "3".repeat(64),
    textSha256: "4".repeat(64),
    textBytes: 21,
    crossOriginAuthorized: false,
    requestedAt: "2026-08-05T00:00:01.000Z",
    settledAt: "2026-08-05T00:00:02.000Z",
    sessionIdSha256: "b".repeat(64),
    sessionOperation: 3,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "7".repeat(64),
    currentUrlSha256: "d".repeat(64),
    currentOriginSha256: "e".repeat(64),
    titleSha256: "f".repeat(64),
    snapshotSha256: "5".repeat(64),
    snapshotChars: 30,
    snapshotTruncated: false,
    contentSha256: "6".repeat(64),
  };
}
