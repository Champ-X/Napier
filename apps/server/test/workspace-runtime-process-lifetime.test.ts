import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createServices } from "../src/app.js";
import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.js";
import { workspaceRuntimeCanDispose } from "../src/workspace-runtime-services.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

async function fixture() {
  const f = await runtimeFixture();
  const graphs = new Map<string, Awaited<ReturnType<typeof createServices>>>();
  const host = await createWorkspaceRuntimeHost({
    workspaceRoot: f.a.root, stateHome: f.stateHome, maxIdle: 0,
    services: { env: { NAPIER_HOST_DIRECT_SANDBOX: "1" } },
  }, async (options) => {
    const services = await createServices(options);
    graphs.set(services.store.getWorkspaceSummary().root, services);
    return services;
  });
  const services = graphs.get(f.a.root)!;
  const agent = services.store.listAgents()[0]!;
  const thread = await services.store.createThread({ title: "Process outlives its Run", agentId: agent.id });
  const { run, token } = await services.store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: `process:${process.pid}:process_lifetime_fixture`, ttlMs: 60_000 },
  );
  return {
    f, host, services, thread, run,
    finishRun: () => services.store.finishRun(run.id, "completed", { leaseToken: token }),
    async cleanup() { await host.shutdown(); await f.cleanup(); },
  };
}

describe("workspace process lifetime and idle reclamation", () => {
  it("retains a browser start awaiting credentials even before it has a task ID", async () => {
    const h = await fixture();
    const resolving = deferred<void>(), releaseCredential = deferred<void>();
    const readCredential = vi.spyOn(h.services.credentials, "read").mockImplementation(async () => {
      resolving.resolve(); await releaseCredential.promise; return undefined;
    });
    let starting: ReturnType<typeof h.services.browserTasks.create> | undefined;
    try {
      await h.finishRun();
      starting = h.services.browserTasks.create({
        backend: "browser_use_local", task: "Read the fixture page", startUrl: "https://example.com",
        model: { provider: "openai", id: "fixture-unused" }, credentialEnv: "",
        allowedDomains: ["example.com"], maxSteps: 1, maxCostUsd: 1,
      });
      await resolving.promise;
      expect(h.services.browserTasks.active()).toBeUndefined();
      expect(h.services.browserTasks.hasPendingWork()).toBe(true);
      expect(workspaceRuntimeCanDispose(h.services)).toBe(false);
      expect((await h.host.reclaimIdle()).sort()).toEqual([h.f.b.workspaceId, h.f.c.workspaceId].sort());
      releaseCredential.resolve();
      await expect(starting).rejects.toMatchObject({ code: "credential_missing" });
      expect(h.services.browserTasks.hasPendingWork()).toBe(false);
      expect(await h.host.reclaimIdle()).toEqual([h.f.a.workspaceId]);
    } finally {
      releaseCredential.resolve(); await starting?.catch(() => undefined);
      readCredential.mockRestore(); await h.cleanup();
    }
  });

  it("retains preparation, a live OS process, and terminal persistence before reclaiming historical sessions", async () => {
    const h = await fixture();
    const preparing = deferred<void>(), allowLaunch = deferred<void>();
    const persisting = deferred<void>(), allowPersist = deferred<void>();
    const processes = h.services.workspaceProcesses;
    const stopFile = path.join(h.f.directory, "finish-process");
    const launch = h.services.sandbox.launch.bind(h.services.sandbox);
    const launchSpy = vi.spyOn(h.services.sandbox, "launch").mockImplementation(async (request) => {
      preparing.resolve(); await allowLaunch.promise; return launch(request);
    });
    const append = h.services.store.appendEvent.bind(h.services.store);
    const appendSpy = vi.spyOn(h.services.store, "appendEvent").mockImplementation(async (input) => {
      if (input.type === "workspace.process.settled") { persisting.resolve(); await allowPersist.promise; }
      return append(input);
    });
    let start: ReturnType<typeof processes.start> | undefined;
    try {
      expect(processes.hasPendingWork()).toBe(false);
      start = processes.start({
        threadId: h.thread.id, runId: h.run.id,
        command: { runtime: "node", args: ["-e", `process.stdout.write("ready"); setInterval(() => { if (require("node:fs").existsSync(${JSON.stringify(stopFile)})) process.exit(0); }, 10);`], timeoutMs: 30_000 },
      });
      await preparing.promise;
      expect(processes.hasPendingWork()).toBe(true);
      expect(workspaceRuntimeCanDispose(h.services)).toBe(false);
      expect((await h.host.reclaimIdle()).sort()).toEqual([h.f.b.workspaceId, h.f.c.workspaceId].sort());
      allowLaunch.resolve(); const session = await start;
      await h.finishRun();
      await vi.waitFor(async () => {
        const output = await processes.output(h.thread.id, session.id);
        expect(output.chunks.map((chunk) => chunk.text).join("")).toContain("ready");
      });
      expect(h.services.store.listRuns(h.thread.id).every((run) => run.status === "completed")).toBe(true);
      expect(await h.host.reclaimIdle()).toEqual([]);
      await writeFile(stopFile, "finish");
      await persisting.promise;
      expect((await processes.list(h.thread.id))[0]?.status).toBe("succeeded");
      expect(processes.hasPendingWork()).toBe(true);
      expect(await h.host.reclaimIdle()).toEqual([]);
      allowPersist.resolve(); await processes.waitForSettlement(h.thread.id, session.id);
      expect(processes.hasPendingWork()).toBe(false);
      expect(await h.host.reclaimIdle()).toEqual([h.f.a.workspaceId]);
      const response = await h.host.fetch(new Request(`http://localhost/api/threads/${h.thread.id}/processes`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject([{ id: session.id, status: "succeeded" }]);
    } finally {
      allowLaunch.resolve(); allowPersist.resolve();
      await start?.catch(() => undefined);
      launchSpy.mockRestore(); appendSpy.mockRestore(); await h.cleanup();
    }
  }, 30_000);

  it("retains and drains compensation after a real failed writer has exited", async () => {
    const h = await fixture();
    const compensating = deferred<void>(), allowCompensation = deferred<void>();
    const processes = h.services.workspaceProcesses;
    const target = path.join(h.f.a.root, "result.txt");
    await writeFile(target, "before");
    const append = h.services.store.appendEvent.bind(h.services.store);
    const appendSpy = vi.spyOn(h.services.store, "appendEvent").mockImplementation(async (input) => {
      const event = await append(input);
      if (input.type === "workspace.process.rollback_started") { compensating.resolve(); await allowCompensation.promise; }
      return event;
    });
    let shuttingDown: Promise<void> | undefined;
    try {
      const preview = await processes.previewWrite({
        threadId: h.thread.id, runId: h.run.id, writePaths: ["result.txt"], failureRecovery: "restore_scopes",
        command: { runtime: "node", args: ["-e", 'require("node:fs").writeFileSync("result.txt", "after"); process.exit(1);'], timeoutMs: 30_000 },
      });
      const session = await processes.startWrite({ threadId: h.thread.id, runId: h.run.id, previewId: preview.id });
      await compensating.promise;
      await h.finishRun();
      expect(await readFile(target, "utf8")).toBe("after");
      expect((await processes.list(h.thread.id))[0]?.status).toBe("failed");
      expect(processes.hasPendingWork()).toBe(true);
      expect(workspaceRuntimeCanDispose(h.services)).toBe(false);
      expect((await h.host.reclaimIdle()).sort()).toEqual([h.f.b.workspaceId, h.f.c.workspaceId].sort());
      let drained = false;
      const firstShutdown = processes.shutdown();
      expect(processes.shutdown()).toBe(firstShutdown);
      shuttingDown = firstShutdown.then(() => { drained = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(drained).toBe(false);
      allowCompensation.resolve(); await shuttingDown;
      expect(await readFile(target, "utf8")).toBe("before");
      expect(processes.hasPendingWork()).toBe(false);
      expect((await processes.list(h.thread.id))[0]).toMatchObject({ id: session.id, workspaceCompensationStatus: "restored" });
      expect(await h.host.reclaimIdle()).toEqual([h.f.a.workspaceId]);
    } finally {
      allowCompensation.resolve(); await shuttingDown;
      appendSpy.mockRestore(); await h.cleanup();
    }
  }, 30_000);

  it("terminates a launched process that registers only after shutdown starts", async () => {
    const h = await fixture();
    const processes = h.services.workspaceProcesses;
    let shutdown: Promise<void> | undefined;
    const launch = h.services.sandbox.launch.bind(h.services.sandbox);
    const launchSpy = vi.spyOn(h.services.sandbox, "launch").mockImplementation(async (request) => {
      const child = await launch(request);
      const end = child.stdin.end.bind(child.stdin);
      // launchWorkspaceProcess has passed its shutdown check before closing
      // noninteractive stdin, but has not returned the new entry to the manager.
      child.stdin.end = (() => { shutdown = processes.shutdown(); return end(); }) as typeof child.stdin.end;
      return child;
    });
    try {
      const session = await processes.start({
        threadId: h.thread.id, runId: h.run.id,
        command: { runtime: "node", args: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 30_000 },
      });
      expect(shutdown).toBeDefined();
      await shutdown;
      expect(processes.hasPendingWork()).toBe(false);
      expect(await processes.waitForSettlement(h.thread.id, session.id)).toMatchObject({ status: "interrupted" });
    } finally { launchSpy.mockRestore(); await h.cleanup(); }
  }, 10_000);

  it("releases the lifecycle reservation after a rejected launch", async () => {
    const h = await fixture();
    const launch = vi.spyOn(h.services.sandbox, "launch").mockRejectedValue(new Error("Injected launch failure"));
    try {
      await expect(h.services.workspaceProcesses.start({
        threadId: h.thread.id, runId: h.run.id, command: { runtime: "node", args: ["-e", "void 0"] },
      })).rejects.toThrow("Injected launch failure");
      await h.finishRun();
      expect(h.services.workspaceProcesses.hasPendingWork()).toBe(false);
      expect(workspaceRuntimeCanDispose(h.services)).toBe(true);
      expect((await h.host.reclaimIdle()).sort()).toEqual([h.f.a, h.f.b, h.f.c].map((identity) => identity.workspaceId).sort());
    } finally { launch.mockRestore(); await h.cleanup(); }
  });
});
