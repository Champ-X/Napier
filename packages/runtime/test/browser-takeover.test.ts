import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSessionControlService } from "../src/browser-session-control.js";
import { BrowserSessionPauseManager } from "../src/browser-session-pause.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser takeover", () => {
  it("uses a paused fresh snapshot and records type values by hash only", async () => {
    const fixture = await createFixture();
    const snapshotText = '- textbox "Password" [ref=e6]';
    const captureBrowserTakeoverSnapshot = vi.fn(async () =>
      captureResult(snapshotText, 2),
    );
    const executeBrowserTakeoverAction = vi.fn(async () => ({
      output: "PRIVATE_TYPED_PAGE_OUTPUT",
      details: details("type", 3, '- textbox "Password" [ref=e6]'),
    }));
    const pauses = new BrowserSessionPauseManager(fixture.store);
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot,
        executeBrowserTakeoverAction,
      },
      pauses,
    );
    const before = await fixture.store.listEvents(fixture.threadId);
    const paused = await service.pause(fixture.threadId, fixture.runId);

    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    expect(snapshot.snapshot).toBe(snapshotText);
    expect(snapshot.pauseStateSha256).toBe(paused.contentSha256);
    expect(await fixture.store.listEvents(fixture.threadId)).toEqual([
      ...before,
      expect.objectContaining({ type: "browser.session_pause.requested" }),
    ]);

    const secret = "PRIVATE_TAKEOVER_PASSWORD";
    const receipt = await service.executeTakeover(
      fixture.threadId,
      fixture.runId,
      {
        action: "type",
        ref: "e6",
        text: secret,
        expectedPauseStateSha256: snapshot.pauseStateSha256,
        expectedSessionIdSha256: snapshot.sessionIdSha256,
        expectedSessionOperation: snapshot.sessionOperation,
        expectedSnapshotSha256: snapshot.snapshotSha256,
        expectedActiveTabId: snapshot.activeTabId,
        expectedTabCount: snapshot.tabCount,
        expectedTabSetSha256: snapshot.tabSetSha256,
      },
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        action: "type",
        status: "completed",
        textSha256: sha256(secret),
        textBytes: Buffer.byteLength(secret),
        targetRefSha256: sha256("e6"),
        sessionOperation: 3,
      }),
    );
    expect(executeBrowserTakeoverAction).toHaveBeenCalledWith(
      { threadId: fixture.threadId, runId: fixture.runId },
      expect.objectContaining({ action: "type", ref: "e6", text: secret }),
      undefined,
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events
        .filter((event) => event.type.startsWith("browser.takeover."))
        .map((event) => event.type),
    ).toEqual(["browser.takeover.requested", "browser.takeover.completed"]);
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain(snapshotText);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_TYPED_PAGE_OUTPUT");

    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        action: "type",
        ref: "e6",
        text: "replay",
        expectedPauseStateSha256: snapshot.pauseStateSha256,
        expectedSessionIdSha256: snapshot.sessionIdSha256,
        expectedSessionOperation: snapshot.sessionOperation,
        expectedSnapshotSha256: snapshot.snapshotSha256,
        expectedActiveTabId: snapshot.activeTabId,
        expectedTabCount: snapshot.tabCount,
        expectedTabSetSha256: snapshot.tabSetSha256,
      }),
    ).rejects.toThrow("snapshot changed");
    await fixture.store.close();
  });

  it("serializes resume behind an in-flight takeover action", async () => {
    const fixture = await createFixture();
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });
    let actionStarted = false;
    const pauses = new BrowserSessionPauseManager(fixture.store);
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult("- button [ref=e1]", 1),
        ),
        executeBrowserTakeoverAction: vi.fn(async () => {
          actionStarted = true;
          await actionGate;
          return {
            output: "clicked",
            details: details("click", 2, "- button [ref=e1]"),
          };
        }),
      },
      pauses,
    );
    const paused = await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);
    const executing = service.executeTakeover(fixture.threadId, fixture.runId, {
      action: "click",
      ref: "e1",
      expectedPauseStateSha256: snapshot.pauseStateSha256,
      expectedSessionIdSha256: snapshot.sessionIdSha256,
      expectedSessionOperation: snapshot.sessionOperation,
      expectedSnapshotSha256: snapshot.snapshotSha256,
      expectedActiveTabId: snapshot.activeTabId,
      expectedTabCount: snapshot.tabCount,
      expectedTabSetSha256: snapshot.tabSetSha256,
    });
    await vi.waitFor(() => expect(actionStarted).toBe(true));
    let resumed = false;
    const resuming = service
      .resume(fixture.threadId, fixture.runId, paused.contentSha256)
      .then((state) => {
        resumed = true;
        return state;
      });
    await Promise.resolve();
    expect(resumed).toBe(false);

    releaseAction();
    await expect(executing).resolves.toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    await expect(resuming).resolves.toEqual(
      expect.objectContaining({ status: "running" }),
    );
    expect(resumed).toBe(true);
    await fixture.store.close();
  });

  it("validates exact tab lifecycle transitions and stale tab bindings", async () => {
    const fixture = await createFixture();
    const snapshotText = "- heading [ref=e1]";
    let activeTabId = "tab_1";
    let tabIds = ["tab_1"];
    let operation = 1;
    const captureBrowserTakeoverSnapshot = vi.fn(async () =>
      captureResult(snapshotText, operation, activeTabId, tabIds),
    );
    const executeBrowserTakeoverAction = vi.fn(async (_owner, request) => {
      operation += 1;
      if (request.action === "tab_new") {
        tabIds = [...tabIds, "tab_2"];
        activeTabId = "tab_2";
      } else if (request.action === "tab_switch") {
        activeTabId = request.tabId;
      } else if (request.action === "tab_close") {
        tabIds = tabIds.filter((tabId) => tabId !== request.tabId);
        if (activeTabId === request.tabId) activeTabId = tabIds[0]!;
      }
      return {
        output: "PRIVATE_TAB_ACTION_OUTPUT",
        details: details(
          request.action,
          operation,
          snapshotText,
          activeTabId,
          tabIds,
        ),
      };
    });
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot,
        executeBrowserTakeoverAction,
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);

    const first = await service.snapshot(fixture.threadId, fixture.runId);
    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(first),
        action: "tab_new",
        url: "https://two.example/",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "tab_new",
        activeTabId: "tab_2",
        tabCount: 2,
        targetUrlSha256: sha256("https://two.example/"),
      }),
    );

    const second = await service.snapshot(fixture.threadId, fixture.runId);
    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(second),
        action: "tab_switch",
        tabId: "tab_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "tab_switch",
        activeTabId: "tab_1",
        tabCount: 2,
      }),
    );

    const third = await service.snapshot(fixture.threadId, fixture.runId);
    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(third),
        expectedTabSetSha256: "f".repeat(64),
        action: "tab_close",
        tabId: "tab_2",
      }),
    ).rejects.toThrow("snapshot changed");
    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(third),
        action: "tab_close",
        tabId: "tab_2",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "tab_close",
        activeTabId: "tab_1",
        tabCount: 1,
      }),
    );
    expect(
      JSON.stringify(await fixture.store.listEvents(fixture.threadId)),
    ).not.toContain("https://two.example/");
    await fixture.store.close();
  });

  it("rejects an inactive-tab close that changes the active tab", async () => {
    const fixture = await createFixture();
    const snapshotText = "- heading [ref=e1]";
    const tabIds = ["tab_1", "tab_2"];
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult(snapshotText, 2, "tab_1", tabIds),
        ),
        executeBrowserTakeoverAction: vi.fn(async () => ({
          output: "invalid close",
          details: details("tab_close", 3, snapshotText, "tab_3", ["tab_1"]),
        })),
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(snapshot),
        action: "tab_close",
        tabId: "tab_2",
      }),
    ).rejects.toThrow("action failed");
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(events.at(-1)?.type).toBe("browser.takeover.failed");
    await fixture.store.close();
  });

  it("binds visual clicks to the exact live image and hashes coordinates", async () => {
    const fixture = await createFixture();
    const snapshotText = "- heading [ref=e1]";
    const executeBrowserTakeoverAction = vi.fn(async () => ({
      output: "PRIVATE_VISUAL_CLICK_OUTPUT",
      details: details("visual_click", 2, snapshotText),
    }));
    const captureBrowserLiveView = vi.fn(async () => ({
      image: Buffer.from("live pixels"),
      receipt: liveReceipt(1, sha256("live pixels")),
    }));
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult(snapshotText, 1),
        ),
        captureBrowserLiveView,
        executeBrowserTakeoverAction,
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    const receipt = await service.executeTakeover(
      fixture.threadId,
      fixture.runId,
      {
        ...binding(snapshot),
        action: "visual_click",
        expectedLiveImageSha256: sha256("live pixels"),
        expectedViewportWidth: 1_280,
        expectedViewportHeight: 900,
        x: 640,
        y: 450,
      },
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        action: "visual_click",
        sourceLiveImageSha256: sha256("live pixels"),
        viewportWidth: 1_280,
        viewportHeight: 900,
        coordinateXSha256: sha256("640"),
        coordinateYSha256: sha256("450"),
      }),
    );
    expect(captureBrowserLiveView).toHaveBeenCalledOnce();
    expect(executeBrowserTakeoverAction).toHaveBeenCalledWith(
      { threadId: fixture.threadId, runId: fixture.runId },
      expect.objectContaining({
        action: "visual_click",
        x: 640,
        y: 450,
      }),
      undefined,
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(JSON.stringify(events)).not.toContain('"x":640');
    expect(JSON.stringify(events)).not.toContain('"y":450');
    expect(JSON.stringify(events)).not.toContain("PRIVATE_VISUAL_CLICK_OUTPUT");
    await fixture.store.close();
  });

  it("rejects a visual click when the displayed live image is stale", async () => {
    const fixture = await createFixture();
    const snapshotText = "- heading [ref=e1]";
    const executeBrowserTakeoverAction = vi.fn();
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult(snapshotText, 1),
        ),
        captureBrowserLiveView: vi.fn(async () => ({
          image: Buffer.from("new pixels"),
          receipt: liveReceipt(1, sha256("new pixels")),
        })),
        executeBrowserTakeoverAction,
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    await expect(
      service.executeTakeover(fixture.threadId, fixture.runId, {
        ...binding(snapshot),
        action: "visual_click",
        expectedLiveImageSha256: sha256("old pixels"),
        expectedViewportWidth: 1_280,
        expectedViewportHeight: 900,
        x: 100,
        y: 200,
      }),
    ).rejects.toThrow("action failed");
    expect(executeBrowserTakeoverAction).not.toHaveBeenCalled();
    expect(
      (await fixture.store.listEvents(fixture.threadId)).at(-1)?.type,
    ).toBe("browser.takeover.failed");
    await fixture.store.close();
  });

  it("records screenshot output by path and file hash without the raw path", async () => {
    const fixture = await createFixture();
    const snapshotText = "- heading [ref=e1]";
    const imageSha256 = sha256("live pixels");
    const outputPath = "artifacts/private-browser.png";
    let plan = await fixture.store.createPlan(fixture.threadId, {
      objective: "Save a Browser screenshot.",
      steps: [
        {
          id: "capture",
          title: "Capture screenshot",
          description: "Save the Browser screenshot.",
          verification: "The declared Artifact is produced.",
        },
      ],
      artifacts: [
        {
          id: "browser-screenshot",
          path: outputPath,
          kind: "file",
          description: "The Browser screenshot.",
        },
      ],
    });
    plan = await fixture.store.transitionPlanStep(plan.id, "capture", {
      action: "start",
      runId: fixture.runId,
    });
    await mkdir(path.join(fixture.workspaceRoot, "artifacts"));
    await writeFile(
      path.join(fixture.workspaceRoot, outputPath),
      "live pixels",
    );
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult(snapshotText, 1),
        ),
        captureBrowserLiveView: vi.fn(async () => ({
          image: Buffer.from("live pixels"),
          receipt: liveReceipt(1, imageSha256),
        })),
        executeBrowserTakeoverAction: vi.fn(async () => ({
          output: `Workspace file: ${outputPath}`,
          details: details(
            "save_screenshot",
            2,
            snapshotText,
            "tab_1",
            ["tab_1"],
            {
              file: {
                pathSha256: sha256(outputPath),
                fileSha256: imageSha256,
                fileBytes: 11,
              },
            },
          ),
        })),
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    const receipt = await service.executeTakeover(
      fixture.threadId,
      fixture.runId,
      {
        ...binding(snapshot),
        action: "save_screenshot",
        path: outputPath,
        expectedLiveImageSha256: imageSha256,
        expectedViewportWidth: 1_280,
        expectedViewportHeight: 900,
      },
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        action: "save_screenshot",
        outputPathSha256: sha256(outputPath),
        outputFileSha256: imageSha256,
        outputFileBytes: 11,
        sourceLiveImageSha256: imageSha256,
      }),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      JSON.stringify(
        events.filter((event) => event.type.startsWith("browser.takeover.")),
      ),
    ).not.toContain(outputPath);
    expect(fixture.store.getPlan(plan.id).artifacts[0]).toEqual(
      expect.objectContaining({
        id: "browser-screenshot",
        status: "verified",
        sourceRunId: fixture.runId,
        sha256: imageSha256,
        sizeBytes: 11,
      }),
    );
    expect(
      events
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    await fixture.store.close();
  });

  it("records downloaded file evidence without target path or content", async () => {
    const fixture = await createFixture();
    const snapshotText = '- link "Download" [ref=e3]';
    const outputPath = "downloads/private-report.pdf";
    const fileSha256 = sha256("PRIVATE_DOWNLOAD_BODY");
    const service = new BrowserSessionControlService(
      fixture.store,
      {
        hasActiveBrowserSession: vi.fn(() => true),
        captureBrowserTakeoverSnapshot: vi.fn(async () =>
          captureResult(snapshotText, 1),
        ),
        executeBrowserTakeoverAction: vi.fn(async () => ({
          output: `PRIVATE_DOWNLOAD_BODY ${outputPath}`,
          details: details("download", 2, snapshotText, "tab_1", ["tab_1"], {
            file: {
              pathSha256: sha256(outputPath),
              fileSha256,
              fileBytes: 21,
            },
            suggestedFilenameSha256: sha256("report.pdf"),
          }),
        })),
      },
      new BrowserSessionPauseManager(fixture.store),
    );
    await service.pause(fixture.threadId, fixture.runId);
    const snapshot = await service.snapshot(fixture.threadId, fixture.runId);

    const receipt = await service.executeTakeover(
      fixture.threadId,
      fixture.runId,
      {
        ...binding(snapshot),
        action: "download",
        ref: "e3",
        path: outputPath,
      },
    );

    expect(receipt).toEqual(
      expect.objectContaining({
        action: "download",
        targetRefSha256: sha256("e3"),
        outputPathSha256: sha256(outputPath),
        outputFileSha256: fileSha256,
        outputFileBytes: 21,
        suggestedFilenameSha256: sha256("report.pdf"),
      }),
    );
    const durable = JSON.stringify(
      await fixture.store.listEvents(fixture.threadId),
    );
    expect(durable).not.toContain(outputPath);
    expect(durable).not.toContain("PRIVATE_DOWNLOAD_BODY");
    await fixture.store.close();
  });
});

function details(
  action: string,
  operation: number,
  snapshot: string,
  activeTabId = "tab_1",
  tabIds = ["tab_1"],
  extra: Record<string, unknown> = {},
) {
  return {
    kind: "napier.browser-session-operation" as const,
    schemaVersion: 3 as const,
    action: action as "snapshot",
    sessionMode: "run_persistent" as const,
    sessionReused: true,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    activeTabId,
    tabCount: tabIds.length,
    tabSetSha256: sha256(canonicalJson(tabIds)),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    pageDiagnosis: {
      status: "none" as const,
      signalCount: 0,
      signalsSha256: sha256("[]"),
      takeoverRecommended: false,
    },
    snapshotSha256: sha256(snapshot),
    snapshotChars: snapshot.length,
    snapshotTruncated: false,
    blockedRequestCount: 0,
    network: {
      requestCount: operation,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: sha256(canonicalJson(["example.com"])),
    },
    crossOriginAuthorized: false,
    ...extra,
  };
}

function captureResult(
  snapshot: string,
  operation: number,
  activeTabId = "tab_1",
  tabIds = ["tab_1"],
) {
  return {
    snapshot: {
      output: "PRIVATE_FORMATTED_BROWSER_OUTPUT",
      snapshot,
      details: details("snapshot", operation, snapshot, activeTabId, tabIds),
    },
    tabs: {
      output: "PRIVATE_TAB_LIST",
      tabs: tabIds.map((tabId) => ({
        tabId,
        active: tabId === activeTabId,
        url: `https://${tabId}.example/`,
        title: tabId,
      })),
      details: details("tab_list", operation, snapshot, activeTabId, tabIds),
    },
  };
}

function binding(
  snapshot: Awaited<ReturnType<BrowserSessionControlService["snapshot"]>>,
) {
  return {
    expectedPauseStateSha256: snapshot.pauseStateSha256,
    expectedSessionIdSha256: snapshot.sessionIdSha256,
    expectedSessionOperation: snapshot.sessionOperation,
    expectedSnapshotSha256: snapshot.snapshotSha256,
    expectedActiveTabId: snapshot.activeTabId,
    expectedTabCount: snapshot.tabCount,
    expectedTabSetSha256: snapshot.tabSetSha256,
  };
}

function liveReceipt(operation: number, imageSha256: string) {
  const content = {
    kind: "napier.browser-live-view" as const,
    schemaVersion: 4 as const,
    threadId: "thread_live",
    runId: "run_live",
    sessionIdSha256: "a".repeat(64),
    sessionOperation: operation,
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    imageSha256,
    imageBytes: 11,
    mimeType: "image/png" as const,
    viewportWidth: 1_280,
    viewportHeight: 900,
    capturedAt: "2026-08-05T00:00:00.000Z",
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    networkRequestCount: operation,
    blockedRequestCount: 0,
    pageDiagnosis: {
      status: "none" as const,
      signalCount: 0,
      signalsSha256: sha256("[]"),
      takeoverRecommended: false,
    },
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-takeover-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser takeover",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    source: "user",
    model: { provider: "faux-browser-takeover", id: "faux-1" },
  });
  return { store, workspaceRoot, threadId: thread.id, runId: run.id };
}
