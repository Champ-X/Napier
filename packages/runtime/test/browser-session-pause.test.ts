import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSessionPauseManager } from "../src/browser-session-pause.js";
import { LocalStore } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Session pause manager", () => {
  it("activates before Ledger I/O and resumes only the exact pause state", async () => {
    let releaseAppend!: () => void;
    const firstAppend = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const appendEvent = vi
      .fn()
      .mockImplementationOnce(async () => await firstAppend)
      .mockResolvedValue(undefined);
    const manager = new BrowserSessionPauseManager({
      appendEvent,
    } as never);
    const owner = { threadId: "thread_pause", runId: "run_pause" };

    const pausing = manager.pause(owner);
    const paused = manager.state(owner);
    expect(paused.status).toBe("paused");
    let released = false;
    const waiting = manager.waitIfPaused(owner).then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    releaseAppend();
    await expect(pausing).resolves.toEqual(paused);
    await expect(manager.pause(owner)).resolves.toEqual(paused);
    await expect(manager.resume(owner, "0".repeat(64))).rejects.toThrow(
      "pause state changed",
    );
    expect(released).toBe(false);

    const running = await manager.resume(owner, paused.contentSha256);
    await waiting;
    expect(running).toEqual(
      expect.objectContaining({
        status: "running",
        pauseRequestedAt: paused.pauseRequestedAt,
        resumedAt: expect.any(String),
      }),
    );
    expect(released).toBe(true);
    expect(manager.state(owner).status).toBe("running");
    expect(
      appendEvent.mock.calls.map(([event]) => ({
        type: event.type,
        payload: event.payload,
      })),
    ).toEqual([
      expect.objectContaining({
        type: "browser.session_pause.requested",
        payload: expect.objectContaining({ status: "paused" }),
      }),
      expect.objectContaining({
        type: "browser.session_pause.resumed",
        payload: expect.objectContaining({ status: "running" }),
      }),
    ]);
  });

  it("rolls back failed pause evidence and rejects blocked Browser actions", async () => {
    const evidenceFailure = new Error("Ledger unavailable");
    const manager = new BrowserSessionPauseManager({
      appendEvent: vi.fn(async () => {
        throw evidenceFailure;
      }),
    } as never);
    const owner = { threadId: "thread_failed", runId: "run_failed" };

    const pausing = manager.pause(owner);
    const waiting = manager.waitIfPaused(owner);

    await expect(pausing).rejects.toThrow("Ledger unavailable");
    await expect(waiting).rejects.toThrow("Ledger unavailable");
    expect(manager.state(owner).status).toBe("running");
  });

  it("records hash-only cancellation and rejects all waiters", async () => {
    const fixture = await createFixture();
    const manager = new BrowserSessionPauseManager(fixture.store);
    const owner = { threadId: fixture.threadId, runId: fixture.runId };
    await manager.pause(owner);
    const first = manager.waitIfPaused(owner);
    const second = manager.waitIfPaused(owner);

    await manager.cancelRun(owner);

    await expect(first).rejects.toThrow("pause wait was cancelled");
    await expect(second).rejects.toThrow("pause wait was cancelled");
    expect(manager.state(owner).status).toBe("running");
    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) => event.type.startsWith("browser.session_pause."),
    );
    expect(events.map((event) => event.type)).toEqual([
      "browser.session_pause.requested",
      "browser.session_pause.cancelled",
    ]);
    expect(events[1]?.payload).toEqual(
      expect.objectContaining({
        status: "cancelled",
        cancelledAt: expect.any(String),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("page");
    await fixture.store.close();
  });

  it("cancels the pause when the Browser Session closes while waiting", async () => {
    const fixture = await createFixture();
    const manager = new BrowserSessionPauseManager(fixture.store);
    const owner = { threadId: fixture.threadId, runId: fixture.runId };
    let active = true;
    await manager.pause(owner);
    const waiting = manager.waitIfPaused(owner, undefined, () => active);

    active = false;

    await expect(waiting).rejects.toThrow("closed while paused");
    expect(manager.state(owner).status).toBe("running");
    expect(
      (await fixture.store.listEvents(fixture.threadId))
        .filter((event) => event.type.startsWith("browser.session_pause."))
        .map((event) => event.type),
    ).toEqual([
      "browser.session_pause.requested",
      "browser.session_pause.cancelled",
    ]);
    await fixture.store.close();
  });
});

async function createFixture(): Promise<{
  store: LocalStore;
  threadId: string;
  runId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-pause-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser pause",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    model: { provider: "faux-browser-pause", id: "faux-1" },
  });
  return { store, threadId: thread.id, runId: run.id };
}
