import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
    const captureBrowserTakeoverSnapshot = vi.fn(async () => ({
      output: "PRIVATE_FORMATTED_BROWSER_OUTPUT",
      snapshot: snapshotText,
      details: details("snapshot", 2, snapshotText),
    }));
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
        captureBrowserTakeoverSnapshot: vi.fn(async () => ({
          output: "snapshot",
          snapshot: "- button [ref=e1]",
          details: details("snapshot", 1, "- button [ref=e1]"),
        })),
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
});

function details(action: string, operation: number, snapshot: string) {
  return {
    kind: "napier.browser-session-operation" as const,
    schemaVersion: 1 as const,
    action: action as "snapshot",
    sessionMode: "run_persistent" as const,
    sessionReused: true,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
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
  return { store, threadId: thread.id, runId: run.id };
}
