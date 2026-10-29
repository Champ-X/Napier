import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { ModelRouter } from "../src/model-route.js";
import { LocalStore } from "../src/store.js";
import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import type { SubagentExecutionContext } from "../src/subagent-execution-context.js";
import { WORKFLOW_NODE_EXECUTION } from "../src/workflow-node-execution.js";

const fixtures: Array<{ root: string; store: LocalStore }> = [];
afterEach(async () => {
  for (const { root, store } of fixtures.splice(0)) {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

describe("child route ownership and deferred selection", () => {
  for (const source of ["user", "workflow"] as const) {
    for (const routing of ["implicit_role", "explicit_role", "parent_path"] as const) {
      it(`keeps queued and actual models aligned for ${source} ${routing}`, async () => {
        const root = await mkdtemp(path.join(tmpdir(), "napier-child-route-"));
        const workspaceRoot = path.join(root, "workspace");
        await mkdir(workspaceRoot);
        const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
        fixtures.push({ root, store });
        await store.initialize();
        const faux = fauxProvider({ provider: "child-route-fixture", models: [
          { id: "primary", reasoning: false }, { id: "selected", reasoning: false },
        ] });
        const primaryRef = { provider: faux.provider.id, id: "primary" };
        const selectedRef = { provider: faux.provider.id, id: "selected" };
        const policy = {
          schemaVersion: 2 as const, roles: {},
          ...(routing === "implicit_role" ? { subagentRoles: { researcher: { model: selectedRef } } } : {}),
          ...(routing === "parent_path" ? { paths: {
            [source === "user" ? "interactive" : "workflow"]: { model: selectedRef },
            experiment: { model: primaryRef },
          } } : {}),
        };
        const agent = await store.updateAgent(store.listAgents()[0]!.id, {
          model: primaryRef, modelRoute: policy, enabledTools: [], enabledSubagents: ["researcher"],
          subagentLimits: { maxConcurrent: 1, maxTotal: 2, maxTurns: 2, timeoutMs: 10_000 },
        });
        const thread = await store.createThread({ title: "Child route", agentId: agent.id });
        const plan = source === "workflow" ? await store.createPlan(thread.id, {
          objective: "Route a workflow child", steps: [{ id: "route", title: "Route", description: "Inspect route owner", verification: "Child owns route evidence" }],
        }) : undefined;
        const parent = await store.createRun({ threadId: thread.id, agentId: agent.id, source,
          ...(plan ? { [WORKFLOW_NODE_EXECUTION]: { planId: plan.id } } : {}),
        });
        const profile = effectiveRunProfile(agent, parent);
        const registry = new ModelRegistry();
        registry.registerProvider(faux.provider);
        const primary = registry.resolve(primaryRef)!;
        const router = new ModelRouter(store, registry);
        const createSession = vi.spyOn(router, "createSession");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const createInheritedTools = vi.fn((_context: SubagentExecutionContext) => []);
        const cleanupExecutionResources = vi.fn(async () => undefined);
        const provider = new InProcessSubagentProvider({
          store, models: registry.models, modelRouter: router, defaultModel: primary, profile, run: parent,
          limits: profile.subagentLimits!, parentSignal: new AbortController().signal,
          concurrencyGate: new ToolConcurrencyGate({ durable: { backend: store.toolConcurrencyLeaseBackend(), ownerId: "child_route_fixture" } }),
          createInheritedTools, cleanupExecutionResources,
          schedule: async (operation) => { await gate; return operation(); },
        });
        faux.setResponses([fauxAssistantMessage('"done"')]);
        const handle = await provider.start({
          kind: "napier.subagent-request", schemaVersion: 1, threadId: thread.id, runId: parent.id,
          role: "researcher", description: "Deferred route", prompt: "Return done", outputSchema: { type: "string" },
          ...(routing === "explicit_role" ? { modelRoute: { subagentRoles: { researcher: { model: selectedRef } } } } : {}),
        }, {});
        const queued = store.listSubagentTasks(thread.id)[0]!;
        expect(queued.model).toEqual(selectedRef);
        expect(queued.childRunId).toBeUndefined();
        expect(createSession).not.toHaveBeenCalled();
        expect(faux.state.callCount).toBe(0);
        release();
        const collected = await provider.collect(handle);
        expect(collected.status, collected.task.error).toBe("completed");
        expect(createSession).toHaveBeenCalledOnce();
        const input = createSession.mock.calls[0]![0];
        expect(input.run.id).toBe(collected.task.childRunId);
        expect(input.selectionSource).toBe(source);
        const session = await createSession.mock.results[0]!.value;
        expect(session.primary.id).toBe(queued.model.id);
        expect(session.plan.runId).toBe(collected.task.childRunId);
        expect(createInheritedTools.mock.calls[0]![0].executionRun.id).toBe(collected.task.childRunId);
        expect(cleanupExecutionResources).toHaveBeenCalledWith(expect.objectContaining({ id: collected.task.childRunId }));
        expect(faux.state.callCount).toBe(1);
      });
    }
  }
});
