import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { createServices } from "../src/app.js";
import { createWorkspaceRuntimeHost } from "../src/workspace-runtime-host.js";
import { processReadySandbox } from "./process-run-readiness-test-fixture.js";
import { deferred, runtimeFixture } from "./workspace-runtime-test-fixture.js";

describe("production host model resource ownership", () => {
  it("lets a parent and delegated child finish with one global model slot and counts physical calls once", async () => {
    const f = await runtimeFixture();
    const provider = fauxProvider({ provider: "faux-model-family" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("delegate_task", {
        role: "researcher", description: "Inspect the request", task: "Return a concise typed result without tools.",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage(JSON.stringify({ summary: "Child result retained", items: [], unknowns: [] })),
      fauxAssistantMessage("Parent used the child result."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    let services!: Awaited<ReturnType<typeof createServices>>;
    const host = await createWorkspaceRuntimeHost({
      workspaceRoot: f.a.root, stateHome: f.stateHome,
      modelBudget: { maxConcurrent: 1, zeroCostModels: ["faux-model-family/faux-1"] },
      services: { env: {}, sandbox: processReadySandbox("model-family") },
    }, async (options) => {
      const graph = await createServices(options);
      if (graph.store.workspaceRoot === f.a.root) { graph.models.registerProvider(provider.provider); services = graph; }
      return graph;
    });
    try {
      const agent = await services.store.updateAgent(services.store.listAgents()[0]!.id, {
        model: { provider: "faux-model-family", id: "faux-1" }, enabledTools: [], enabledSubagents: ["researcher"],
      });
      const thread = await services.store.createThread({ title: "Parent and child", agentId: agent.id });
      const response = await host.fetch(new Request(`http://localhost/api/threads/${thread.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Delegate a bounded inspection and summarize the returned result.", model: agent.model }),
      }));
      await response.text();
      const finished = services.store.listRuns(thread.id).at(-1);
      expect(finished?.status, finished?.error).toBe("completed");
      expect(services.store.listSubagentTasks(thread.id)).toEqual([expect.objectContaining({ status: "completed" })]);
      const summary = await (await host.fetch(new Request("http://localhost/api/workspace/resources"))).json();
      expect(provider.state.callCount).toBeGreaterThanOrEqual(3);
      expect(summary).toMatchObject({ activeInvocations: 0, budgetInvocations: provider.state.callCount });
      expect(services.store.listSubagentTasks(thread.id)[0]?.usageStatus).toBe("complete");
    } finally { await host.shutdown(); await f.cleanup(); }
  }, 30_000);

  it("retains physical A calls after Run cancellation and refuses B before provider dispatch", async () => {
    const f = await runtimeFixture();
    const started = deferred<void>(); const release = deferred<void>();
    const graphs = new Map<string, Awaited<ReturnType<typeof createServices>>>();
    const calls = new Map<string, number>();
    const host = await createWorkspaceRuntimeHost({
      workspaceRoot: f.a.root, stateHome: f.stateHome, maxIdle: 0,
      modelBudget: { maxConcurrent: 1, zeroCostModels: ["faux-model-host/faux-1"] },
      services: { env: {}, sandbox: processReadySandbox("model-host") },
    }, async (options) => {
      const services = await createServices(options);
      const root = services.store.workspaceRoot;
      const provider = fauxProvider({ provider: "faux-model-host" });
      provider.setResponses([async () => {
        calls.set(root, (calls.get(root) ?? 0) + 1);
        if (root === f.a.root) { started.resolve(); await release.promise; }
        return fauxAssistantMessage(`Complete in ${root}`);
      }, fauxAssistantMessage('{"facts":[]}')]);
      services.models.registerProvider(provider.provider);
      await services.store.updateAgent(services.store.listAgents()[0]!.id, {
        model: { provider: "faux-model-host", id: "faux-1" }, enabledTools: [], enabledSubagents: [],
      });
      graphs.set(root, services); return services;
    });
    const request = (id: string, resource: string, init?: RequestInit) => host.fetch(new Request(`http://localhost/api/workspaces/${id}/${resource}`, init));
    const post = (id: string, threadId: string) => request(id, `threads/${threadId}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Use only the fixture model.", model: { provider: "faux-model-host", id: "faux-1" } }),
    });
    const snapshot = async () => (await request(f.a.workspaceId, "workspace/resources")).json();
    let body: Promise<string> | undefined;
    try {
      const a = graphs.get(f.a.root)!;
      const b = graphs.get(f.b.root)!;
      const left = await a.store.createThread({ title: "A physical request", agentId: a.store.listAgents()[0]!.id });
      const right = await b.store.createThread({ title: "B backpressure", agentId: b.store.listAgents()[0]!.id });
      body = (await post(f.a.workspaceId, left.id)).text();
      await started.promise;
      const denied = await post(f.b.workspaceId, right.id); await denied.text();
      expect(calls.get(f.b.root) ?? 0).toBe(0);
      expect(b.store.listRuns(right.id)[0]?.status).toBe("failed");
      expect(await snapshot()).toMatchObject({ activeInvocations: 1, budgetInvocations: 1 });
      const stopped = await request(f.a.workspaceId, `threads/${left.id}/stop`, { method: "POST" });
      await stopped.text(); expect(stopped.status).toBe(202);
      await body;
      expect(a.store.listRuns(left.id)[0]?.status).toBe("cancelled");
      expect(await snapshot()).toMatchObject({ activeInvocations: 1 });
      const reclaimed = await host.reclaimIdle();
      expect(reclaimed).toContain(f.b.workspaceId);
      expect(reclaimed).not.toContain(f.a.workspaceId);
      release.resolve();
      await vi.waitFor(async () => expect(await snapshot()).toMatchObject({ activeInvocations: 0 }), { timeout: 5_000 });
      const completed = await post(f.b.workspaceId, right.id); await completed.text();
      expect(calls.get(f.b.root)).toBe(1);
      expect(graphs.get(f.b.root)!.store.listRuns(right.id).at(-1)?.status).toBe("completed");
      expect(await host.reclaimIdle()).toContain(f.a.workspaceId);
    } finally {
      release.resolve(); await body?.catch(() => undefined);
      await host.shutdown(); await f.cleanup();
    }
  }, 30_000);
});
