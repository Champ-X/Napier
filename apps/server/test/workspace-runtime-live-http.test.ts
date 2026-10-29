import { writeFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { describe, expect, it, vi } from "vitest";

import { createApp, createServices, type NapierServices } from "../src/app.js";
import { createWorkspaceRuntimeFetch, WORKSPACE_RUNTIME_HEADER } from "../src/workspace-runtime-http.js";
import { WorkspaceRuntimeRegistry } from "../src/workspace-runtime-registry.js";
import { workspaceRebindBusyReasons } from "../src/workspace-rebind.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

async function dispose(services: NapierServices): Promise<void> {
  await Promise.all([
    services.automation.stop(), services.channels.stop(), services.recovery.stop(),
    services.receiptTrustDirectorySubscriptions.stop(),
  ]);
  await services.shutdownLocalRuntime();
}

describe("workspace registry with real HTTP and Runtime ledgers", () => {
  it("runs B and A automation while A is detached, scopes controls/files, then reopens both ledgers", async () => {
    const f = await runtimeFixture();
    const graphs = new Map<string, { services: NapierServices; app: ReturnType<typeof createApp> }>();
    const disposed: string[] = [];
    const registry = new WorkspaceRuntimeRegistry({
      catalog: f.catalog, maxResident: 3, maxIdle: 0,
      prepare: async (identity) => {
        const services = await createServices({
          workspaceRoot: identity.root, dataRoot: identity.dataRoot, env: {}, startAutomation: true,
          sandbox: processReadySandbox("workspace-registry-live-http"),
        });
        const graph = { services, app: createApp(services) };
        graphs.set(identity.workspaceId, graph);
        return graph;
      },
      dispose: async (graph) => { await dispose(graph.services); disposed.push(graph.services.store.workspaceRoot); },
      // This fixture has Runs and schedules only. Production composition must
      // also inventory channel, recovery, workflow and browser obligations.
      canDispose: ({ services }) => workspaceRebindBusyReasons(services.store).length === 0 &&
        !services.store.listSchedules().some((schedule) => schedule.status === "active"),
    });
    const dispatch = createWorkspaceRuntimeFetch({
      registry, defaultWorkspaceId: f.a.workspaceId,
      fetch: (graph, request) => graph.app.fetch(request),
    });
    const server = serve({ fetch: dispatch, hostname: "127.0.0.1", port: 0 });
    if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    const base = `http://127.0.0.1:${address.port}`;
    const url = (id: string, endpoint: string) => `${base}/api/workspaces/${id}/${endpoint}`;
    const releaseA = deferred<void>();
    const startedA = deferred<void>();
    let pendingA: Response | undefined;
    let bodyA: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      for (const identity of [f.a, f.b]) {
        const response = await fetch(url(identity.workspaceId, "bootstrap"));
        expect(response.status).toBe(200);
        expect(response.headers.get(WORKSPACE_RUNTIME_HEADER)).toBe(identity.workspaceId);
        expect((await response.json()).workspace).toMatchObject({ root: identity.root, dataRoot: identity.dataRoot });
        await writeFile(path.join(identity.root, "same-output.txt"), path.basename(identity.root));
      }
      const a = graphs.get(f.a.workspaceId)!.services;
      const b = graphs.get(f.b.workspaceId)!.services;
      const agentA = a.store.listAgents()[0]!;
      const agentB = b.store.listAgents()[0]!;
      const threadA = await a.store.createThread({ title: "A long task", agentId: agentA.id });
      const threadB = await b.store.createThread({ title: "B task", agentId: agentB.id });
      const backgroundA = await a.store.createThread({ title: "A automation", agentId: agentA.id });
      const runPrompt = a.kernel.runPrompt.bind(a.kernel);
      a.kernel.runPrompt = (options) => runPrompt({ ...options, onEvent: async (event) => {
        await options.onEvent?.(event);
        if (event.threadId === threadA.id && event.type === "run.started") {
          startedA.resolve(); await releaseA.promise;
        }
      } });
      const model = { provider: "napier", id: "demo" };
      const post = (id: string, threadId: string) => fetch(url(id, `threads/${threadId}/messages`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Check the workspace identity without tools.", model }),
      });
      pendingA = await post(f.a.workspaceId, threadA.id);
      expect(pendingA.status).toBe(200);
      bodyA = pendingA.body!.getReader();
      await bodyA.read();
      await startedA.promise;
      // Browser navigation disconnects its response, not the execution owner.
      await bodyA.cancel();
      const bResponse = await post(f.b.workspaceId, threadB.id);
      const bSse = await bResponse.text();
      expect(bSse).toContain("event: done");
      expect(bSse).toContain(threadB.id);
      expect(bSse).not.toContain(threadA.id);
      expect(b.store.listRuns(threadB.id)[0]?.status).toBe("completed");
      expect(a.store.listRuns(threadA.id)[0]?.status).toBe("running");

      const wrongStop = await fetch(url(f.b.workspaceId, `threads/${threadA.id}/stop`), { method: "POST" });
      expect(wrongStop.status).toBe(409);
      expect(await wrongStop.json()).toEqual({ stopped: false });
      expect(a.store.listRuns(threadA.id)[0]?.status).toBe("running");
      for (const identity of [f.a, f.b]) {
        const output = await fetch(url(identity.workspaceId, "workspace/file?path=same-output.txt"));
        expect(output.status).toBe(200);
        expect(await output.text()).toBe(path.basename(identity.root));
      }

      const schedule = await a.store.createSchedule({
        name: "Background A after B selection", threadId: backgroundA.id,
        prompt: "Record this scheduled invocation.", model,
        trigger: { type: "interval", everyMs: 60_000, anchorAt: new Date(Date.now() + 100).toISOString() },
      });
      await vi.waitFor(() => {
        const runs = a.store.listRuns(backgroundA.id);
        expect(runs).toHaveLength(1); expect(runs[0]?.status).toBe("completed");
        // Run completion precedes the scheduler's own durable settlement.
        expect(a.store.getSchedule(schedule.id).lastRunId).toBe(runs[0]?.id);
      }, { timeout: 10_000, interval: 100 });
      expect(await registry.reclaimIdle()).toEqual([f.b.workspaceId]);
      expect(disposed).not.toContain(f.a.root);
      releaseA.resolve();
      await vi.waitFor(() => expect(a.store.listRuns(threadA.id)[0]?.status).toBe("completed"), { timeout: 5_000 });
      await registry.shutdown();

      // Reopen with the exact persisted data roots, using real LocalStore reload.
      for (const [identity, threadId] of [[f.a, threadA.id], [f.b, threadB.id]] as const) {
        const recovered = await createServices({
          workspaceRoot: f.catalog.get(identity.workspaceId).root,
          dataRoot: f.catalog.get(identity.workspaceId).dataRoot, env: {},
          sandbox: processReadySandbox("workspace-registry-reopen"),
        });
        try {
          expect(recovered.store.listRuns(threadId)).toHaveLength(1);
          expect(recovered.store.listRuns(threadId)[0]?.status).toBe("completed");
          if (identity === f.a) expect(recovered.store.getSchedule(schedule.id).lastRunId).toBeDefined();
        } finally { await dispose(recovered); }
      }
    } finally {
      releaseA.resolve();
      await bodyA?.cancel().catch(() => undefined);
      await registry.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await f.cleanup();
    }
  }, 30_000);
});
