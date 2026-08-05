import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserLiveViewService } from "../src/browser-live-view.js";
import { LocalStore } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Live view service", () => {
  it("allows only the active user Run and appends no Ledger event", async () => {
    const fixture = await createFixture("user");
    const captureBrowserLiveView = vi.fn(async () => ({
      image: Buffer.from("live"),
      receipt: {
        kind: "napier.browser-live-view" as const,
        schemaVersion: 3 as const,
        threadId: fixture.threadId,
        runId: fixture.runId,
        sessionIdSha256: "a".repeat(64),
        sessionOperation: 2,
        activeTabId: "tab_1",
        tabCount: 1,
        tabSetSha256: "9".repeat(64),
        imageSha256: "b".repeat(64),
        imageBytes: 4,
        mimeType: "image/png" as const,
        viewportWidth: 1_280,
        viewportHeight: 900,
        capturedAt: "2026-08-04T00:00:00.000Z",
        currentUrlSha256: "c".repeat(64),
        currentOriginSha256: "d".repeat(64),
        titleSha256: "e".repeat(64),
        browserExecutableSha256: "f".repeat(64),
        browserVersionSha256: "1".repeat(64),
        limitsSha256: "2".repeat(64),
        networkRequestCount: 3,
        blockedRequestCount: 1,
        contentSha256: "3".repeat(64),
      },
    }));
    const service = new BrowserLiveViewService(fixture.store, {
      captureBrowserLiveView,
    });
    const before = await fixture.store.listEvents(fixture.threadId);

    await expect(
      service.capture(fixture.threadId, fixture.runId),
    ).resolves.toEqual(expect.objectContaining({ image: Buffer.from("live") }));
    expect(captureBrowserLiveView).toHaveBeenCalledWith(
      { threadId: fixture.threadId, runId: fixture.runId },
      undefined,
    );
    expect(await fixture.store.listEvents(fixture.threadId)).toEqual(before);
    await fixture.store.finishRun(fixture.runId, "completed");
    await expect(
      service.capture(fixture.threadId, fixture.runId),
    ).rejects.toThrow("active user Run");
    await fixture.store.close();
  });

  it("rejects a running non-user Run", async () => {
    const fixture = await createFixture("schedule");
    const service = new BrowserLiveViewService(fixture.store, {
      captureBrowserLiveView: vi.fn(),
    });
    await expect(
      service.capture(fixture.threadId, fixture.runId),
    ).rejects.toThrow("active user Run");
    await fixture.store.close();
  });
});

async function createFixture(source: "user" | "schedule"): Promise<{
  store: LocalStore;
  threadId: string;
  runId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-live-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser Live",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    source,
    model: { provider: "faux-browser-live", id: "faux-1" },
  });
  return { store, threadId: thread.id, runId: run.id };
}
