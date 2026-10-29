import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.js";
import { WorkspaceRuntimeCatalog } from "../src/workspace-runtime-catalog.js";
import { createServices } from "../src/app.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";
import { runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("production workspace host", () => {
  it("reclaims idle graphs but retains future automation until it is paused", async () => {
    const f = await runtimeFixture();
    const graphs = new Map<string, Awaited<ReturnType<typeof createServices>>>();
    const host = await createWorkspaceRuntimeHost({
      workspaceRoot: f.a.root, stateHome: f.stateHome, maxIdle: 0,
      services: { env: {}, sandbox: processReadySandbox("workspace-host-idle") },
    }, async (options) => {
      const services = await createServices(options);
      graphs.set(services.store.getWorkspaceSummary().root, services);
      return services;
    });
    try {
      const a = graphs.get(f.a.root)!;
      const agent = a.store.listAgents()[0]!;
      const thread = await a.store.createThread({ title: "Future automation", agentId: agent.id });
      const schedule = await a.store.createSchedule({
        name: "Future work", threadId: thread.id, prompt: "Remain available without a browser.",
        model: { provider: "napier", id: "demo" },
        trigger: { type: "interval", everyMs: 60_000, anchorAt: new Date(Date.now() + 3_600_000).toISOString() },
      });
      expect((await host.reclaimIdle()).sort()).toEqual([f.b.workspaceId, f.c.workspaceId].sort());
      expect(a.store.getSchedule(schedule.id).status).toBe("active");
      await a.store.updateSchedule(schedule.id, { status: "paused" });
      expect(await host.reclaimIdle()).toEqual([f.a.workspaceId]);
      const response = await host.fetch(new Request("http://localhost/api/bootstrap"));
      expect((await response.json()).workspace.dataRoot).toBe(f.a.dataRoot);
      expect(graphs.get(f.a.root)).not.toBe(a);
      expect(graphs.get(f.a.root)!.store.getSchedule(schedule.id).status).toBe("paused");
    } finally { await host.shutdown(); await f.cleanup(); }
  });

  it("closes its catalog if registry policy validation fails", async () => {
    const f = await runtimeFixture();
    const close = vi.spyOn(WorkspaceRuntimeCatalog.prototype, "close");
    try {
      await expect(createWorkspaceRuntimeHost({
        workspaceRoot: f.a.root, stateHome: f.stateHome, maxResident: 0,
      })).rejects.toThrow("Invalid workspace registry resource policy");
      expect(close).toHaveBeenCalledTimes(1);
      expect(f.catalog.list()).toHaveLength(3);
    } finally { close.mockRestore(); await f.cleanup(); }
  });

  it("keeps recent navigation in the explicitly configured state home", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "napier-host-state-"));
    const stateHome = path.join(directory, "explicit-state");
    const ambient = path.join(directory, "ambient-state");
    const workspaceRoot = path.join(directory, "project");
    await mkdir(workspaceRoot);
    vi.stubEnv("NAPIER_STATE_HOME", ambient);
    const host = await createWorkspaceRuntimeHost({
      workspaceRoot, stateHome, services: { env: {}, sandbox: processReadySandbox("workspace-host-state") },
    });
    try {
      const response = await host.fetch(new Request("http://localhost/api/workspace/recent"));
      expect((await response.json()).map((entry: { root: string }) => entry.root)).toEqual([host.initial.root]);
      expect(JSON.parse(await readFile(path.join(stateHome, "recent-workspaces.json"), "utf8"))).toHaveLength(1);
      await expect(readFile(path.join(ambient, "recent-workspaces.json"))).rejects.toMatchObject({ code: "ENOENT" });
      const threads = await host.fetch(new Request(`http://localhost/api/workspace/threads?root=${encodeURIComponent(host.initial.root)}`));
      expect(threads.status).toBe(200); await threads.text();
    } finally { await host.shutdown(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
  });

  it("opens B while A streams, keeps the legacy address on A, scopes HTML assets, and restores custom roots", async () => {
    const f = await runtimeFixture();
    vi.stubEnv("NAPIER_STATE_HOME", f.stateHome);
    const options = {
      workspaceRoot: f.a.root, stateHome: f.stateHome,
      services: { env: {}, sandbox: processReadySandbox("workspace-host") },
    };
    let host = await createWorkspaceRuntimeHost(options);
    const request = (endpoint: string, init?: RequestInit) => host.fetch(new Request(`http://localhost${endpoint}`, init));
    const scoped = (id: string, endpoint: string) => `/api/workspaces/${id}/${endpoint}`;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      expect(host.initial).toEqual(f.a);
      const boot = await (await request("/api/bootstrap")).json();
      const created = await request(scoped(f.a.workspaceId, "threads"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "A stays running", agentId: boot.agents[0].id }),
      });
      expect(created.status).toBe(201);
      const thread = (await created.json()).thread;
      const stream = await request(scoped(f.a.workspaceId, `threads/${thread.id}/messages`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Keep this run in A.", model: { provider: "napier", id: "demo" } }),
      });
      expect(stream.status).toBe(200);
      reader = stream.body!.getReader(); await reader.read();
      const opened = await request(scoped(f.a.workspaceId, "workspace/root"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ root: f.b.root }),
      });
      expect(opened.status).toBe(200);
      expect(await opened.json()).toMatchObject({ workspaceId: f.b.workspaceId, root: f.b.root, dataRoot: f.b.dataRoot });
      expect((await (await request("/api/bootstrap")).json()).workspace.root).toBe(f.a.root);
      expect((await (await request(scoped(f.b.workspaceId, "bootstrap"))).json()).workspace.root).toBe(f.b.root);
      await reader.cancel();

      await writeFile(path.join(f.b.root, "index.html"), '<script src="main.js"></script><p>B preview</p>');
      await writeFile(path.join(f.b.root, "main.js"), 'document.body.dataset.workspace = "B";');
      const preview = await request(scoped(f.b.workspaceId, "workspace/file?path=index.html"));
      expect(preview.status).toBe(200);
      const previewPath = preview.headers.get("X-Napier-Workspace-Preview-Url")!;
      await preview.text();
      const addressedPreview = scoped(f.b.workspaceId, previewPath.slice(5));
      const html = await request(addressedPreview);
      expect(html.headers.get("Content-Security-Policy")).toContain(`http://localhost${path.posix.dirname(addressedPreview)}/`);
      expect(await html.text()).toContain("B preview");
      const asset = await request(`${path.posix.dirname(addressedPreview)}/main.js`);
      expect(await asset.text()).toContain('"B"');
      const wrongPreview = await request(scoped(f.a.workspaceId, previewPath.slice(5)));
      expect(wrongPreview.status).toBe(410); await wrongPreview.text();
      await host.shutdown();
      host = await createWorkspaceRuntimeHost(options);
      const restored = await request(scoped(f.b.workspaceId, "bootstrap"));
      expect((await restored.json()).workspace).toMatchObject({ root: f.b.root, dataRoot: f.b.dataRoot });
      const history = await request(scoped(f.a.workspaceId, `threads/${thread.id}`));
      expect((await history.json()).runs.at(-1).status).toBe("completed");
    } finally {
      await reader?.cancel().catch(() => undefined);
      await host.shutdown(); vi.unstubAllEnvs(); await f.cleanup();
    }
  }, 30_000);
});
