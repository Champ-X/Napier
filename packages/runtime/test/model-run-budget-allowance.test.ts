import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyUsage } from "@napier/contracts";
import { accountingFixture } from "./model-accounting-fixture.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { drainModelCallAccounting } from "../src/model-call-admission.js";
import { completeModelInvocation } from "../src/model-complete-invocation.js";
import { projectPendingModelUsage } from "../src/model-usage-projection.js";
import { issueModelUndispatchedDriverProof, readPreparedModelCall, type PreparedModelCall } from "../src/model-call-attribution.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import { modelInputAllowance } from "../src/model-call-budget-allowance.js";
import { createModelCallCaptureBinding } from "../src/model-call-capture.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { modelRunBudgetExposure } from "../src/model-run-budget-exposure.js";
import type { ModelAccountingHost } from "../src/model-accounting-host.js";

const close: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("External models are forbidden"); }));
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const action of close.splice(0).reverse()) await action(); });

async function fixture(limits = { maxTotalTokens: 1200, maxCostUsd: 25 }) {
  const faux = fauxProvider({ provider: "run-allowance", api: "openai-responses", models: [{ id: "small", maxTokens: 700, contextWindow: 4096 }] });
  const model = { ...faux.getModel(), cost: { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 1.25 } };
  const f = await accountingFixture({ model, runLimits: limits });
  close.push(async () => { f.store.close(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  const registry = new ModelRegistry(undefined, createLocalModelCallAdmission(f.source), f.store.modelAccountingRepository);
  const streams: ReturnType<typeof createAssistantMessageEventStream>[] = [];
  const dispatch = vi.fn(() => { const stream = createAssistantMessageEventStream(); streams.push(stream); return stream; });
  registry.registerProvider({ ...faux.provider, stream: dispatch, streamSimple: dispatch });
  const project = () => projectPendingModelUsage(f.source, f.store.modelAccountingRepository,
    { workspaceLedgerId: f.store.modelAccountingRepository.workspaceLedgerId() });
  const response = (tokens: number): AssistantMessage => ({ ...f.fixture.message,
    usage: { input: 0, output: tokens, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
      cost: { input: 0, output: tokens * 0.000002, cacheRead: 0, cacheWrite: 0, total: tokens * 0.000002 } } });
  return { ...f, model, registry, streams, dispatch, project, response };
}

describe("native shared Run nominal allowance", () => {
  it.each(["main", "child"])("shares the ancestor reservation when %s enters first", async (firstKind) => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 });
    const main = await f.main(), child = await (await f.child()).prepare();
    const [first, second] = firstKind === "main" ? [main, child] : [child, main];
    await f.store.modelAccountingRepository.enter(first.prepared);
    await expect(f.store.modelAccountingRepository.enter(second.prepared)).rejects.toThrow("in-flight allowance");
    expect(await f.store.aggregateRunUsage(f.parent.run.id)).toEqual(emptyUsage());
  });
  it.each(["tokens", "cost"])("admits only one of two concurrent children sharing %s, before any receipt", async (kind) => {
    const f = await fixture(kind === "tokens" ? undefined : { maxTotalTokens: 0, maxCostUsd: 0.01 });
    const children = [await f.child(), await f.child()];
    const calls = children.map((child) => completeModelInvocation({ models: f.registry.models, model: f.model,
      context: f.fixture.context, options: { maxTokens: 700 }, phase: "subagent_turn",
      accounting: { repository: f.store.modelAccountingRepository, owner: child.authority, logicalCallId: child.reservation.invocationId } })
      .then((message) => ({ message }), (error: unknown) => ({ error })));
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledTimes(1));
    const events = (await Promise.all(children.map((child) => f.store.listRunEvents(child.child.run.id)))).flat();
    await vi.waitFor(async () => expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary.unresolvedInvocations).toBe(1));
    expect(events.filter((event) => event.type === "model.accounting.dispatch_intent")).toHaveLength(1);
    expect((await f.store.aggregateRunUsage(f.parent.run.id))).toEqual(emptyUsage());
    f.streams[0]!.push({ type: "done", reason: "stop", message: f.response(700) });
    const results = await Promise.all(calls); await f.project();
    expect(results.filter((result) => "error" in result)).toHaveLength(1);
    expect(String(results.find((result) => "error" in result)?.error)).toContain("in-flight allowance");
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).outputTokens).toBe(700);
    const after = await Promise.all(children.map((child) => f.store.listRunEvents(child.child.run.id)));
    expect(after.flat().filter((event) => event.type === "model.usage.reconciled")).toHaveLength(2);
  });

  it("replaces known allowance with exact usage once and preserves actual overruns", async () => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 });
    const first = await f.main(); await f.store.modelAccountingRepository.enter(first.prepared);
    const second = await f.main(); await expect(f.store.modelAccountingRepository.enter(second.prepared)).rejects.toThrow("in-flight allowance");
    f.source.reserve(first.attribution);
    f.source.record(normalizeModelPhysicalObservation({ attribution: first.attribution, terminal: "response", message: f.response(20) }));
    const delivery = f.source.pending()[0]!;
    await f.store.modelAccountingRepository.reconcile(delivery);
    await f.store.modelAccountingRepository.reconcile(delivery);
    await f.store.modelAccountingRepository.enter(second.prepared);
    f.source.reserve(second.attribution);
    f.source.record(normalizeModelPhysicalObservation({ attribution: second.attribution, terminal: "response", message: f.response(1100) }));
    await f.project();
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).outputTokens).toBe(1120);
    await expect(f.store.modelAccountingRepository.enter((await f.main()).prepared)).rejects.toThrow("accounted Run budget");
  });

  it.each(["unknown", "partial"])("retains %s remainder across a cold restart without clamping canonical usage", async (kind) => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 }), first = await f.main();
    await f.store.modelAccountingRepository.enter(first.prepared); f.source.reserve(first.attribution);
    const message = f.response(40);
    if (kind === "partial") delete (message.usage as Partial<typeof message.usage>).input;
    f.source.record(normalizeModelPhysicalObservation({ attribution: first.attribution, terminal: "rejected",
      ...(kind === "partial" ? { message } : {}) }));
    await f.project();
    const saved = canonicalJson(await f.store.aggregateRunUsage(f.parent.run.id));
    await f.store.shutdown();
    const reopened = new LocalStore(f.options); await reopened.initializeAccounting();
    close.push(async () => { reopened.close(); }); reopened.modelAccountingRepository.configureSource({ source: f.source });
    const next = await reopened.modelAccountingRepository.prepare({ owner: reopened.modelAccountingRepository.runAuthority({ runId: f.parent.run.id, token: f.parent.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "after-restart", model: f.model, capture: f.fixture.attribution.capture });
    await expect(reopened.modelAccountingRepository.enter(next)).rejects.toThrow("in-flight allowance");
    expect(canonicalJson(await reopened.aggregateRunUsage(f.parent.run.id))).toBe(saved);
  });

  it("releases only affirmative undispatched proof and a duplicate cannot release another call", async () => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 }), first = await f.main();
    await f.store.modelAccountingRepository.enter(first.prepared);
    const proof = issueModelUndispatchedDriverProof(first.prepared);
    await f.store.modelAccountingRepository.rejectUndispatched(proof, "cancelled_before_raw_entry");
    const second = await f.main(); await f.store.modelAccountingRepository.enter(second.prepared);
    await f.store.modelAccountingRepository.rejectUndispatched(proof, "duplicate");
    await expect(f.store.modelAccountingRepository.enter((await f.main()).prepared)).rejects.toThrow("in-flight allowance");
    expect(await f.store.aggregateRunUsage(f.parent.run.id)).toEqual(emptyUsage());
  });

  it("does not refund caller cancellation after raw entry and settles the late native receipt once", async () => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 }), abort = new AbortController();
    let prepared!: PreparedModelCall;
    const prepare = f.store.modelAccountingRepository.prepare.bind(f.store.modelAccountingRepository);
    vi.spyOn(f.store.modelAccountingRepository, "prepare").mockImplementation(async (input) => { prepared = await prepare(input); return prepared; });
    const call = completeModelInvocation({ models: f.registry.models, model: f.model, context: f.fixture.context,
      options: { maxTokens: 100, signal: abort.signal }, phase: "agent_turn", accounting: {
        repository: f.store.modelAccountingRepository, owner: f.store.modelAccountingRepository.runAuthority({ runId: f.parent.run.id, token: f.parent.token }), logicalCallId: "cancelled" } });
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledOnce());
    abort.abort(); expect((await call).stopReason).toBe("aborted");
    expect(() => issueModelUndispatchedDriverProof(prepared)).toThrow("cannot claim undispatched");
    await expect(f.store.modelAccountingRepository.enter((await f.main()).prepared)).rejects.toThrow("in-flight allowance");
    expect(modelRunBudgetExposure(f.store as unknown as ModelAccountingHost, f.parent.run.id).reservedTokens).toBeGreaterThan(0);
    f.streams[0]!.push({ type: "done", reason: "stop", message: f.response(20) });
    await drainModelCallAccounting(f.registry.models); await f.project();
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).outputTokens).toBe(20);
    expect(modelRunBudgetExposure(f.store as unknown as ModelAccountingHost, f.parent.run.id).reservedTokens).toBe(0);
    await f.store.modelAccountingRepository.enter((await f.main()).prepared);
  });

  it("treats a historical dispatched invocation without allowance as unbounded, while preparation alone reserves nothing", async () => {
    const f = await fixture(), call = await f.main();
    expect(modelRunBudgetExposure(f.store as unknown as ModelAccountingHost, f.parent.run.id).reservedTokens).toBe(0);
    await f.store.modelAccountingRepository.enter(call.prepared);
    const events = structuredClone(await f.store.listRunEvents(f.parent.run.id));
    const legacy = structuredClone(call.attribution); delete legacy.budgetAllowance; delete legacy.capture.inputAllowance;
    const { contentSha256: _hash, ...content } = legacy; legacy.contentSha256 = sha256(canonicalJson(content));
    for (const event of events) {
      if (event.type === "model.accounting.prepared") event.payload = { attribution: JSON.parse(canonicalJson(legacy)) };
      if (event.type === "model.accounting.dispatch_intent") event.payload = { physicalId: legacy.physicalId,
        attributionSha256: legacy.contentSha256, accountingMode: "physical_receipt_v1" };
    }
    const host = { state: { subagents: [] }, mutableRun: () => f.parent.run,
      requireLedger: () => ({ listRunEvents: () => events }) } as unknown as ModelAccountingHost;
    expect(modelRunBudgetExposure(host, f.parent.run.id)).toMatchObject({ accountedTokens: 0, reservedTokens: 0, unboundedInvocations: 1 });
  });

  it("rejects unknown price, allows an explicit local free model, and distinguishes unsupported inputs", async () => {
    const f = await fixture(), free = { ...f.model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const g = await accountingFixture({ model: free, runLimits: { maxTotalTokens: 1000 } });
    close.push(async () => { await g.store.shutdown(); g.source.close(); await rm(g.root, { recursive: true, force: true }); });
    await expect(g.store.modelAccountingRepository.enter((await g.main()).prepared)).rejects.toThrow("unknown price");
    g.store.modelAccountingRepository.configureSource({ source: g.source, isDeclaredZeroCost: () => true });
    const call = await g.main(); await g.store.modelAccountingRepository.enter(call.prepared);
    expect(call.attribution.budgetAllowance?.budgetCostUsd).toBe(0);
    expect(modelInputAllowance({ ...free, api: "custom-unsupported" }, g.fixture.context)).toMatchObject({ policy: "model_context_fallback_v1", reason: "unsupported_api", inputTokens: 4096 });
    expect(modelInputAllowance(free, { messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "AA==" }], timestamp: 0 }] }))
      .toMatchObject({ policy: "model_context_fallback_v1", reason: "non_text_input" });
  });

  it("rechecks request-derived allowance before raw dispatch and refunds a forged lower capture only with undispatched proof", async () => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 });
    const capture = createModelCallCaptureBinding({ model: f.model, context: f.fixture.context,
      options: { maxTokens: 100 }, envelope: f.fixture.attribution.capture.envelope });
    capture.inputAllowance!.inputTokens = 1;
    await expect(completeModelInvocation({ models: f.registry.models, model: f.model, context: f.fixture.context,
      options: { maxTokens: 100 }, phase: "agent_turn", capture, accounting: { repository: f.store.modelAccountingRepository,
        owner: f.store.modelAccountingRepository.runAuthority({ runId: f.parent.run.id, token: f.parent.token }), logicalCallId: "forged-allowance" } }))
      .rejects.toThrow("accounting");
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(await f.store.aggregateRunUsage(f.parent.run.id)).toEqual(emptyUsage());
    const receipts = (await f.store.listRunEvents(f.parent.run.id)).filter((event) => event.type === "model.usage.reconciled");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.payload).toMatchObject({ observation: { terminal: "undispatched", usageStatus: "known_zero_undispatched" } });
    await f.store.modelAccountingRepository.enter((await f.main()).prepared);
  });

  it("keeps old capture explicit and prevents two Store instances from committing the same remaining allowance", async () => {
    const f = await fixture({ maxTotalTokens: 1000, maxCostUsd: 25 });
    const legacy = structuredClone(f.fixture.attribution.capture); delete legacy.inputAllowance;
    const old = await f.store.modelAccountingRepository.prepare({ owner: f.store.modelAccountingRepository.runAuthority({ runId: f.parent.run.id, token: f.parent.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "legacy", model: f.model, capture: legacy });
    expect(readPreparedModelCall(old).attribution.budgetAllowance?.input.reason).toBe("legacy_capture");
    await expect(f.store.modelAccountingRepository.enter(old)).rejects.toThrow("model_context_fallback_v1");
    const a = await f.main();
    const other = new LocalStore(f.options); await other.initializeAccounting(); close.push(async () => { other.close(); });
    other.modelAccountingRepository.configureSource({ source: f.source });
    const b = await other.modelAccountingRepository.prepare({ owner: other.modelAccountingRepository.runAuthority({ runId: f.parent.run.id, token: f.parent.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "second-store", model: f.model, capture: f.fixture.attribution.capture });
    const outcomes = await Promise.allSettled([f.store.modelAccountingRepository.enter(a.prepared), other.modelAccountingRepository.enter(b)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect((await other.listRunEvents(f.parent.run.id)).filter((event) => event.type === "model.accounting.dispatch_intent")).toHaveLength(1);
  });
});
