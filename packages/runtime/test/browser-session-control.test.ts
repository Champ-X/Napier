import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserSessionControlService } from "../src/browser-session-control.js";
import { BrowserSessionPauseManager } from "../src/browser-session-pause.js";
import { LocalStore } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Browser Session control service", () => {
  it("controls only an active user Run with an active Browser Session", async () => {
    const fixture = await createFixture("user");
    const hasActiveBrowserSession = vi.fn(() => true);
    const pauses = new BrowserSessionPauseManager(fixture.store);
    const service = new BrowserSessionControlService(
      fixture.store,
      { hasActiveBrowserSession },
      pauses,
    );
    const before = await fixture.store.listEvents(fixture.threadId);

    const running = await service.state(fixture.threadId, fixture.runId);
    expect(running).toEqual(
      expect.objectContaining({
        threadId: fixture.threadId,
        runId: fixture.runId,
        status: "running",
      }),
    );
    expect(await fixture.store.listEvents(fixture.threadId)).toEqual(before);

    const paused = await service.pause(fixture.threadId, fixture.runId);
    expect(paused.status).toBe("paused");
    const resumed = await service.resume(
      fixture.threadId,
      fixture.runId,
      paused.contentSha256,
    );
    expect(resumed.status).toBe("running");
    expect(hasActiveBrowserSession).toHaveBeenCalledWith({
      threadId: fixture.threadId,
      runId: fixture.runId,
    });
    await fixture.store.close();
  });

  it("fails closed for non-user, inactive Run, and missing Browser Session", async () => {
    const scheduled = await createFixture("schedule");
    const scheduledService = new BrowserSessionControlService(
      scheduled.store,
      { hasActiveBrowserSession: vi.fn(() => true) },
      new BrowserSessionPauseManager(scheduled.store),
    );
    await expect(
      scheduledService.pause(scheduled.threadId, scheduled.runId),
    ).rejects.toThrow("active user Run");
    await scheduled.store.close();

    const completed = await createFixture("user");
    await completed.store.finishRun(completed.runId, "completed");
    const completedService = new BrowserSessionControlService(
      completed.store,
      { hasActiveBrowserSession: vi.fn(() => true) },
      new BrowserSessionPauseManager(completed.store),
    );
    await expect(
      completedService.state(completed.threadId, completed.runId),
    ).rejects.toThrow("active user Run");
    await completed.store.close();

    const sessionless = await createFixture("user");
    const sessionlessService = new BrowserSessionControlService(
      sessionless.store,
      { hasActiveBrowserSession: vi.fn(() => false) },
      new BrowserSessionPauseManager(sessionless.store),
    );
    await expect(
      sessionlessService.pause(sessionless.threadId, sessionless.runId),
    ).rejects.toThrow("not active for this Run");
    expect(
      (await sessionless.store.listEvents(sessionless.threadId)).some((event) =>
        event.type.startsWith("browser.session_pause."),
      ),
    ).toBe(false);
    await sessionless.store.close();
  });

  it("cancels a pause if active ownership disappears during persistence", async () => {
    const fixture = await createFixture("user");
    const pauses = new BrowserSessionPauseManager({
      appendEvent: async (event) => {
        const appended = await fixture.store.appendEvent(event);
        if (event.type === "browser.session_pause.requested") {
          await fixture.store.finishRun(fixture.runId, "completed");
        }
        return appended;
      },
    } as never);
    const service = new BrowserSessionControlService(
      fixture.store,
      { hasActiveBrowserSession: vi.fn(() => true) },
      pauses,
    );

    await expect(
      service.pause(fixture.threadId, fixture.runId),
    ).rejects.toThrow("active user Run");
    expect(
      pauses.state({ threadId: fixture.threadId, runId: fixture.runId }),
    ).toEqual(expect.objectContaining({ status: "running" }));
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

async function createFixture(source: "user" | "schedule"): Promise<{
  store: LocalStore;
  threadId: string;
  runId: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-browser-control-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "state"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Browser control",
    agentId: store.listAgents()[0]!.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    source,
    model: { provider: "faux-browser-control", id: "faux-1" },
  });
  return { store, threadId: thread.id, runId: run.id };
}
