import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserTakeoverActionReceipt,
  BrowserTakeoverSnapshot,
} from "@napier/contracts/browser-takeover";

import {
  executeBrowserTakeoverAction,
  getBrowserTakeoverSnapshot,
} from "../src/browser-takeover-api";
import { canonicalJson, sha256Text } from "../src/stable-digest";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Browser takeover Web API", () => {
  it("verifies snapshot text and sends the exact private action once", async () => {
    const snapshot = await snapshotFixture();
    const request = takeoverRequest(snapshot);
    const receipt = await receiptFixture(snapshot, request);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stableResponse(snapshot))
      .mockResolvedValueOnce(stableResponse(receipt));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getBrowserTakeoverSnapshot(snapshot.threadId, snapshot.runId),
    ).resolves.toEqual(snapshot);
    await expect(
      executeBrowserTakeoverAction(snapshot.threadId, snapshot.runId, request),
    ).resolves.toEqual(receipt);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(request),
      }),
    );
    expect(JSON.stringify(receipt)).not.toContain(request.text);
  });

  it("rejects tampered snapshot text and content-bearing receipt fields", async () => {
    const snapshot = await snapshotFixture();
    const receipt = await receiptFixture(snapshot, takeoverRequest(snapshot));
    const tamperedSnapshot = {
      ...snapshot,
      snapshot: "TAMPERED_PAGE",
      contentSha256: await contentSha256({
        ...snapshot,
        snapshot: "TAMPERED_PAGE",
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(stableResponse(tamperedSnapshot))
        .mockResolvedValueOnce(
          stableResponse({
            ...receipt,
            privatePageText: "PRIVATE_PAGE_CONTENT",
            contentSha256: await contentSha256({
              ...receipt,
              privatePageText: "PRIVATE_PAGE_CONTENT",
            }),
          }),
        ),
    );

    await expect(
      getBrowserTakeoverSnapshot(snapshot.threadId, snapshot.runId),
    ).rejects.toThrow("response is invalid");
    await expect(
      executeBrowserTakeoverAction(snapshot.threadId, snapshot.runId, {
        action: "back",
        expectedPauseStateSha256: snapshot.pauseStateSha256,
        expectedSessionIdSha256: snapshot.sessionIdSha256,
        expectedSessionOperation: snapshot.sessionOperation,
        expectedSnapshotSha256: snapshot.snapshotSha256,
        expectedActiveTabId: snapshot.activeTabId,
        expectedTabCount: snapshot.tabCount,
        expectedTabSetSha256: snapshot.tabSetSha256,
      }),
    ).rejects.toThrow("response is invalid");
  });

  it("rejects tab label and tab-set tampering", async () => {
    const snapshot = await snapshotFixture();
    const tamperedTab = {
      ...snapshot,
      tabs: snapshot.tabs.map((tab) => ({
        ...tab,
        title: "TAMPERED_TAB_TITLE",
      })),
    };
    const tamperedSet = {
      ...snapshot,
      tabSetSha256: "f".repeat(64),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          stableResponse({
            ...tamperedTab,
            contentSha256: await contentSha256(tamperedTab),
          }),
        )
        .mockResolvedValueOnce(
          stableResponse({
            ...tamperedSet,
            contentSha256: await contentSha256(tamperedSet),
          }),
        ),
    );

    await expect(
      getBrowserTakeoverSnapshot(snapshot.threadId, snapshot.runId),
    ).rejects.toThrow("response is invalid");
    await expect(
      getBrowserTakeoverSnapshot(snapshot.threadId, snapshot.runId),
    ).rejects.toThrow("response is invalid");
  });

  it("verifies visual click and keypress evidence", async () => {
    const snapshot = await snapshotFixture();
    const visualRequest = {
      action: "visual_click" as const,
      expectedPauseStateSha256: snapshot.pauseStateSha256,
      expectedSessionIdSha256: snapshot.sessionIdSha256,
      expectedSessionOperation: snapshot.sessionOperation,
      expectedSnapshotSha256: snapshot.snapshotSha256,
      expectedActiveTabId: snapshot.activeTabId,
      expectedTabCount: snapshot.tabCount,
      expectedTabSetSha256: snapshot.tabSetSha256,
      expectedLiveImageSha256: "8".repeat(64),
      expectedViewportWidth: 1_280,
      expectedViewportHeight: 900,
      x: 640,
      y: 450,
    };
    const visualReceipt = await actionReceiptFixture(snapshot, visualRequest, {
      sourceLiveImageSha256: visualRequest.expectedLiveImageSha256,
      viewportWidth: 1_280,
      viewportHeight: 900,
      coordinateXSha256: await sha256Text("640"),
      coordinateYSha256: await sha256Text("450"),
    });
    const keyRequest = {
      action: "keypress" as const,
      expectedPauseStateSha256: snapshot.pauseStateSha256,
      expectedSessionIdSha256: snapshot.sessionIdSha256,
      expectedSessionOperation: snapshot.sessionOperation,
      expectedSnapshotSha256: snapshot.snapshotSha256,
      expectedActiveTabId: snapshot.activeTabId,
      expectedTabCount: snapshot.tabCount,
      expectedTabSetSha256: snapshot.tabSetSha256,
      key: "Enter" as const,
    };
    const keyReceipt = await actionReceiptFixture(snapshot, keyRequest, {
      key: "Enter",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(stableResponse(visualReceipt))
        .mockResolvedValueOnce(stableResponse(keyReceipt)),
    );

    await expect(
      executeBrowserTakeoverAction(
        snapshot.threadId,
        snapshot.runId,
        visualRequest,
      ),
    ).resolves.toEqual(visualReceipt);
    await expect(
      executeBrowserTakeoverAction(
        snapshot.threadId,
        snapshot.runId,
        keyRequest,
      ),
    ).resolves.toEqual(keyReceipt);
  });
});

async function snapshotFixture(): Promise<BrowserTakeoverSnapshot> {
  const snapshot = '- textbox "Password" [ref=e6]';
  const tabIds = ["tab_1"];
  const url = "https://example.com/";
  const title = "Example";
  const content = {
    kind: "napier.browser-takeover-snapshot" as const,
    schemaVersion: 2 as const,
    threadId: "thread_web_takeover",
    runId: "run_web_takeover",
    pauseStateSha256: "a".repeat(64),
    sessionIdSha256: "b".repeat(64),
    sessionOperation: 2,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: await sha256Text(canonicalJson(tabIds)),
    tabs: [
      {
        tabId: "tab_1",
        active: true,
        url,
        currentUrlSha256: await sha256Text(url),
        title,
        titleSha256: await sha256Text(title),
      },
    ],
    snapshot,
    snapshotSha256: await sha256Text(snapshot),
    snapshotChars: snapshot.length,
    snapshotTruncated: false,
    currentUrlSha256: "c".repeat(64),
    currentOriginSha256: "d".repeat(64),
    titleSha256: "e".repeat(64),
    capturedAt: "2026-08-05T00:00:00.000Z",
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function receiptFixture(
  snapshot: BrowserTakeoverSnapshot,
  request: ReturnType<typeof takeoverRequest>,
): Promise<BrowserTakeoverActionReceipt> {
  const content = {
    kind: "napier.browser-takeover-action" as const,
    schemaVersion: 2 as const,
    id: "browser_takeover_12345678" as const,
    threadId: snapshot.threadId,
    runId: snapshot.runId,
    action: "type" as const,
    status: "completed" as const,
    requestSha256: await sha256Text(canonicalJson(request)),
    pauseStateSha256: snapshot.pauseStateSha256,
    sourceSessionIdSha256: snapshot.sessionIdSha256,
    sourceSessionOperation: snapshot.sessionOperation,
    sourceSnapshotSha256: snapshot.snapshotSha256,
    sourceActiveTabId: snapshot.activeTabId,
    sourceTabCount: snapshot.tabCount,
    sourceTabSetSha256: snapshot.tabSetSha256,
    targetRefSha256: await sha256Text(request.ref),
    textSha256: await sha256Text(request.text),
    textBytes: new TextEncoder().encode(request.text).byteLength,
    crossOriginAuthorized: false,
    requestedAt: "2026-08-05T00:00:01.000Z",
    settledAt: "2026-08-05T00:00:02.000Z",
    sessionIdSha256: snapshot.sessionIdSha256,
    sessionOperation: 3,
    activeTabId: snapshot.activeTabId,
    tabCount: snapshot.tabCount,
    tabSetSha256: snapshot.tabSetSha256,
    currentUrlSha256: "c".repeat(64),
    currentOriginSha256: "d".repeat(64),
    titleSha256: "e".repeat(64),
    snapshotSha256: "3".repeat(64),
    snapshotChars: snapshot.snapshotChars,
    snapshotTruncated: false,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

async function actionReceiptFixture(
  snapshot: BrowserTakeoverSnapshot,
  request: Parameters<typeof executeBrowserTakeoverAction>[2],
  evidence: Record<string, unknown>,
): Promise<BrowserTakeoverActionReceipt> {
  const content = {
    kind: "napier.browser-takeover-action" as const,
    schemaVersion: 2 as const,
    id: "browser_takeover_visual01" as const,
    threadId: snapshot.threadId,
    runId: snapshot.runId,
    action: request.action,
    status: "completed" as const,
    requestSha256: await sha256Text(canonicalJson(request)),
    pauseStateSha256: snapshot.pauseStateSha256,
    sourceSessionIdSha256: snapshot.sessionIdSha256,
    sourceSessionOperation: snapshot.sessionOperation,
    sourceSnapshotSha256: snapshot.snapshotSha256,
    sourceActiveTabId: snapshot.activeTabId,
    sourceTabCount: snapshot.tabCount,
    sourceTabSetSha256: snapshot.tabSetSha256,
    ...evidence,
    crossOriginAuthorized:
      "allowCrossOrigin" in request && request.allowCrossOrigin === true,
    requestedAt: "2026-08-05T00:00:01.000Z",
    settledAt: "2026-08-05T00:00:02.000Z",
    sessionIdSha256: snapshot.sessionIdSha256,
    sessionOperation: snapshot.sessionOperation + 1,
    activeTabId: snapshot.activeTabId,
    tabCount: snapshot.tabCount,
    tabSetSha256: snapshot.tabSetSha256,
    currentUrlSha256: snapshot.currentUrlSha256,
    currentOriginSha256: snapshot.currentOriginSha256,
    titleSha256: snapshot.titleSha256,
  };
  return {
    ...content,
    contentSha256: await sha256Text(canonicalJson(content)),
  };
}

function takeoverRequest(snapshot: BrowserTakeoverSnapshot) {
  return {
    action: "type" as const,
    ref: "e6",
    text: "PRIVATE_WEB_TAKEOVER_TEXT",
    expectedPauseStateSha256: snapshot.pauseStateSha256,
    expectedSessionIdSha256: snapshot.sessionIdSha256,
    expectedSessionOperation: snapshot.sessionOperation,
    expectedSnapshotSha256: snapshot.snapshotSha256,
    expectedActiveTabId: snapshot.activeTabId,
    expectedTabCount: snapshot.tabCount,
    expectedTabSetSha256: snapshot.tabSetSha256,
  };
}

function stableResponse<Value extends object & { contentSha256: string }>(
  body: Value,
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Napier-Content-SHA256": body.contentSha256,
      "X-Napier-Content-SHA256-Mode": "stable",
    },
  });
}

async function contentSha256(value: Record<string, unknown>): Promise<string> {
  const { contentSha256: _contentSha256, ...content } = value;
  return await sha256Text(canonicalJson(content));
}
