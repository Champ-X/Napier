import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MemoryFact, RunEvent, RunRecord } from "@napier/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { agentInvocationContextFor, createAgentInvocationContextPreparer,
  prepareAgentInvocationContext } from "../src/agent-invocation-context.js";
import { RunInvocationContextCursor } from "../src/run-invocation-context-cursor.js";
import { LocalStore } from "../src/store.js";
import { createThreadBranch } from "../src/thread-branches.js";
import { createMemoryFact, reviewMemoryFact } from "../src/memory.js";
import { sha256 } from "../src/ed25519.js";
import { presetHarnessPolicy } from "../src/harness-policy-profile.js";
import type { AppendEventInput } from "../src/run-event-registry.js";
import { RunBudgetTracker } from "../src/run-budget.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0)) await close(); });
const policy = { ...presetHarnessPolicy("coding-node.v1").context, memory: "task-aware-v1" as const, workingState: "evidence-v1" as const };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-invocation-cursor-"));
  const workspaceRoot = path.join(root, "workspace"); await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  await store.initialize();
  cleanups.push(async () => { await store.shutdown(); await rm(root, { recursive: true, force: true }); });
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ agentId: agent.id, title: "Invocation evidence cursor" });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id,
    model: { provider: "invocation-cursor-fixture", id: "local" } });
  const cursor = new RunInvocationContextCursor(store, run);
  let facts: MemoryFact[] = [];
  const prepare = async (input: { cursor?: RunInvocationContextCursor; run?: RunRecord; events?: RunEvent[];
    runs?: RunRecord[]; stateOnly?: boolean; budget?: RunBudgetTracker } = {}) => {
    const current = input.run ?? run;
    const receipts: AppendEventInput[] = [];
    const context = await prepareAgentInvocationContext({
      context: { messages: [{ role: "user", content: "Unbound compacted conversation.", timestamp: 0 }] },
      run: current, policy: { ...policy, ...(input.stateOnly ? { memory: "legacy" as const } : {}),
        ...(input.budget ? { finalization: "request-aware-v2" as const } : {}) },
      ...(input.cursor ? { eventCursor: input.cursor } : {}), ...(input.budget ? { budget: input.budget } : {}),
      store: { workspaceRoot, dataRoot: store.dataRoot,
        listRuns: (id) => input.runs ?? store.listRuns(id),
        listEvents: (id) => input.events ? Promise.resolve(structuredClone(input.events)) : store.listEvents(id),
        listRunEvents: (id) => input.events ? Promise.resolve(structuredClone(input.events.filter(event => event.runId === id))) : store.listRunEvents(id),
        listMemories: () => structuredClone(facts),
        appendEvent: async (event) => { receipts.push(structuredClone(event)); return store.appendEvent(event); },
      },
    });
    return { view: agentInvocationContextFor(context), query: receipts.find(event => event.type === "context.memory")?.payload["query"] };
  };
  const compare = async (input: Parameters<typeof prepare>[0] = {}) => {
    const current = input.run ?? run;
    // Both arms consume the same complete durable prefix. The first arm's own
    // context.memory receipt must not change the oracle's captured boundary.
    const events = await store.listEvents(current.threadId);
    const observed = await prepare({ ...input, cursor: input.cursor ?? cursor });
    const baseline = { ...input, events }; delete baseline.cursor;
    const expected = await prepare(baseline);
    expect(observed).toEqual(expected);
    return observed;
  };
  const user = (text: string, current = run) => store.appendEvent({ threadId: current.threadId, runId: current.id,
    type: "message.user", category: "message", visibility: "user", payload: { role: "user", text } });
  return { store, workspaceRoot, run, thread, cursor, prepare, compare, user, setFacts: (next: MemoryFact[]) => { facts = next; } };
}

it("uses real SQLite cold/warm ranges and advances past noise while retaining all actual amendments", async () => {
  const f = await fixture();
  for (let index = 0; index < 25; index++) await f.store.appendEvent({ threadId: f.thread.id, runId: f.run.id,
    type: "model.text.delta", category: "model", payload: { text: "noise" } });
  await f.user("Repair shipping thresholds with integer cents.");
  const range = f.store.listEventsRange.bind(f.store), rows: RunEvent[][] = [];
  const query = vi.spyOn(f.store, "listEventsRange").mockImplementation(async (...args) => {
    const result = await range(...args); rows.push(result); return result;
  });
  await f.compare(); expect(rows.map(batch => batch.length)).toEqual([1]);
  await f.compare(); expect(rows.map(batch => batch.length)).toEqual([1, 0]);
  await f.store.appendEvent({ threadId: f.thread.id, runId: f.run.id, type: "model.text.delta", category: "model", payload: { text: "later noise" } });
  await f.compare(); expect(rows.at(-1)).toEqual([]);
  await f.store.queueRunControlMessage({ threadId: f.thread.id, runId: f.run.id, mode: "steering", text: "Keep the public API unchanged." });
  await f.store.deliverNextRunControlMessage(f.thread.id, f.run.id, "steering");
  const controlled = await f.compare();
  expect(rows.at(-1)?.map(event => event.type)).toEqual(["run.control.queued", "run.control.delivered", "message.user"]);
  expect(controlled.view.workingState).toContain("Keep the public API unchanged.");
  expect(controlled.query).toMatchObject({ instructionRevision: 2 });
  const calls = query.mock.calls;
  for (let index = 1; index < calls.length; index++) expect(calls[index]![1]).toBe(calls[index - 1]![2] + 1);
});

it("the production Run preparer owns one cursor across calls while optional reader adapters keep full replay", async () => {
  const f = await fixture(); await f.user("Preserve shipping thresholds.");
  const full = vi.spyOn(f.store, "listEvents"), range = vi.spyOn(f.store, "listEventsRange");
  const adapter = { workspaceRoot: f.workspaceRoot,
    listRuns: f.store.listRuns.bind(f.store), listEvents: f.store.listEvents.bind(f.store),
    listRunEvents: f.store.listRunEvents.bind(f.store), listMemories: () => [], appendEvent: async () => undefined,
  };
  const native = createAgentInvocationContextPreparer({ run: f.run, store: { ...adapter,
    findLatestEvent: f.store.findLatestEvent.bind(f.store), listEventsRange: f.store.listEventsRange.bind(f.store),
  } });
  const input = { context: { messages: [] }, policy };
  const first = agentInvocationContextFor(await native(input));
  expect(agentInvocationContextFor(await native(input))).toEqual(first);
  expect(range).toHaveBeenCalledOnce(); expect(full).not.toHaveBeenCalled();
  const legacy = createAgentInvocationContextPreparer({ run: f.run, store: adapter });
  expect(agentInvocationContextFor(await legacy(input))).toEqual(first);
  expect(full).toHaveBeenCalledOnce();
});

it("rechecks current Runs and recovery lineage without losing already cached events below the watermark", async () => {
  const f = await fixture(); await f.user("Original user scope.");
  await f.store.finishRun(f.run.id, "completed");
  const recovered = await f.store.createRun({ threadId: f.thread.id, agentId: f.run.agentId, parentRunId: f.run.id });
  await f.user("Current recovery amendment.", recovered);
  const cursor = new RunInvocationContextCursor(f.store, recovered);
  const first = await f.compare({ run: recovered, cursor });
  expect(first.view.workingState).toContain("Original user scope.");
  // Metadata can become visible after the events were read. Keep thread event
  // input, and apply fresh allowed Runs/lineage only at projection time.
  const withoutParent = { ...recovered }; delete withoutParent.parentRunId;
  const hidden = await f.prepare({ run: withoutParent, cursor, runs: [withoutParent] });
  expect(hidden.view.workingState).not.toContain("Original user scope.");
  const restored = await f.compare({ run: recovered, cursor });
  expect(restored).toEqual(first);
});

it("keeps real branch copies on the full oracle and never follows their foreign source future", async () => {
  const f = await fixture(); await f.user("Preserve the branch-local threshold.");
  await f.store.queueRunControlMessage({ threadId: f.thread.id, runId: f.run.id, mode: "steering", text: "Retain integer arithmetic." });
  await f.store.deliverNextRunControlMessage(f.thread.id, f.run.id, "steering");
  await f.store.finishRun(f.run.id, "completed");
  const branch = await createThreadBranch(f.store, f.thread.id, { fromSeq: f.store.getThread(f.thread.id).eventCount });
  const recovered = await f.store.createRun({ threadId: branch.run.threadId, agentId: f.run.agentId, parentRunId: branch.run.id });
  const cursor = new RunInvocationContextCursor(f.store, recovered);
  const typed = vi.spyOn(f.store, "listEventsRange"), full = vi.spyOn(f.store, "listEvents");
  const result = await f.compare({ run: recovered, cursor });
  expect(result.view.workingState).toContain("Branch-copied requests");
  expect(result.view.workingState).toContain("Retain integer arithmetic.");
  expect(result.query).toMatchObject({ branchCopies: expect.any(Array) });
  expect(typed).not.toHaveBeenCalled(); expect(full).toHaveBeenCalled();
  // Removing branch metadata after fallback never re-enables a cursor which
  // has already encountered branch history.
  expect(cursor.canRead(recovered, [recovered])).toBe(false);
});

it("switches an existing cursor to full replay when branch metadata becomes visible and keeps rejection evidence", async () => {
  const f = await fixture(); await f.user("Initial request."); await f.compare();
  const events = await f.store.listEvents(f.thread.id);
  const branch = { ...f.run, branchFromSeq: 5, status: "completed" as const };
  const runs = [branch];
  const full = vi.spyOn(f.store, "listEvents");
  await expect(f.prepare({ cursor: f.cursor, runs })).rejects.toThrow("branch history provenance");
  expect(full).toHaveBeenCalled();
  await expect(f.prepare({ runs, events })).rejects.toThrow("branch history provenance");
  expect(f.cursor.canRead(f.run, [f.run])).toBe(false);
});

it("recomputes fact eligibility, dependency and workspace freshness even with no new relevant events", async () => {
  const f = await fixture();
  const text = "export const threshold = 5000;\n", filename = path.join(f.workspaceRoot, "shipping.ts");
  await writeFile(filename, text); await f.user("Repair the shipping threshold.");
  const fact = reviewMemoryFact(createMemoryFact({ content: "Shipping threshold is 5000 integer cents.", category: "context" },
    { type: "manual", fileDependencies: [{ path: "shipping.ts", sha256: sha256(text) }] }), { action: "approve" });
  f.setFacts([fact]);
  await f.store.appendEvent({ threadId: f.thread.id, runId: f.run.id, type: "tool.completed", category: "tool",
    payload: { callId: "patch_shipping", toolName: "apply_patch", details: { pathSha256: sha256("shipping.ts"), afterSha256: sha256(text) } } });
  const first = await f.compare(); expect(first.view.memory).toContain("5000");
  expect(first.view.workingState).toContain('"current":"matches"');
  await writeFile(filename, "export const threshold = 8000;\n");
  const changed = await f.compare(); expect(changed.view.memory).not.toContain("5000");
  expect(changed.view.workingState).toContain('"current":"changed_or_missing"');
  await writeFile(filename, text); f.setFacts([{ ...fact, status: "archived" }]);
  expect((await f.compare()).view.memory).not.toContain("5000");
  f.setFacts([{ ...fact, reviewDueAt: "2000-01-01T00:00:00Z" }]);
  expect((await f.compare()).view.memory).not.toContain("5000");
});

it("preserves legacy capability fallback and state-only lineage reads and refreshes budgets", async () => {
  const f = await fixture(); await f.user("Preserve the requested result.");
  const legacy = new RunInvocationContextCursor({}, f.run);
  const full = vi.spyOn(f.store, "listEvents"), runReads = vi.spyOn(f.store, "listRunEvents");
  expect(await f.prepare({ cursor: legacy })).toEqual(await f.prepare());
  expect(full).toHaveBeenCalled(); full.mockClear();
  await f.prepare({ cursor: f.cursor, stateOnly: true });
  expect(full).not.toHaveBeenCalled(); expect(runReads).toHaveBeenCalledWith(f.run.id);
  const budget = new RunBudgetTracker({ maxTurns: 20, maxTotalTokens: 10000, maxCostUsd: 1, timeoutMs: 900000 });
  const before = await f.prepare({ cursor: f.cursor, budget });
  budget.observeAuxiliaryUsage({ inputTokens: 123, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });
  const after = await f.prepare({ cursor: f.cursor, budget });
  expect(JSON.parse(before.view.budget).remaining.accountedTokens).toBe(10000);
  expect(JSON.parse(after.view.budget).remaining.accountedTokens).toBe(9877);
});
