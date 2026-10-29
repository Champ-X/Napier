import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxThinking } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { accountingFixture } from "./model-accounting-fixture.js";
import { readEnteredModelCall } from "../src/model-call-attribution.js";
import { awaitModelCallRecovery, observeModelCallRecovery, prepareModelCallRecovery,
  type ModelCallRecoveryHandle } from "../src/model-call-recovery.js";
import { projectPendingModelUsage } from "../src/model-usage-projection.js";
import { guardModelThinkingLoop } from "../src/model-thinking-loop-guard.js";
import { createCancellableModelStream } from "../src/model-stream-transport.js";
import { modelUsageFixture } from "./model-usage-fixture.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(cleanup.splice(0).map((close) => close())); });

async function fixture() {
  const f = await accountingFixture();
  cleanup.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  const call = await f.main(), entered = await f.store.modelAccountingRepository.enter(call.prepared);
  const binding = readEnteredModelCall(entered);
  const accounting = { repository: f.store.modelAccountingRepository, owner: binding.authority, logicalCallId: call.attribution.logicalCallId };
  const handle = prepareModelCallRecovery(entered, accounting, call.attribution);
  let complete!: () => void, reject!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; });
  observeModelCallRecovery(entered, completion);
  const wait = (signal = new AbortController().signal, deadlineAt = Date.now() + 5_000) =>
    awaitModelCallRecovery({ handle, attribution: call.attribution, signal, deadlineAt });
  const project = async () => { await f.physical(call, false); await projectPendingModelUsage(f.source, f.store.modelAccountingRepository); };
  return { ...f, call, entered, accounting, handle, wait, project, complete, reject };
}

it("requires physical completion and successful acknowledgement even after the Store already has a known claim", async () => {
  const f = await fixture();
  await f.project();
  let ready = false;
  const result = f.wait().then((value) => { ready = true; return value; });
  await Promise.resolve();
  expect(ready).toBe(false);
  f.reject(new Error("source ACK failed"));
  expect(await result).toBe("accounting_failed");
  expect(f.store.modelAccountingRepository.readAttemptReceipt({ owner: f.accounting.owner,
    physicalId: f.call.attribution.physicalId, attributionSha256: f.call.attribution.contentSha256 }).state).toBe("known");
});

it("unlocks only the exact completed durable receipt, without closing registry admission", async () => {
  const f = await fixture();
  const unrelated = await f.main(), unrelatedEntered = await f.store.modelAccountingRepository.enter(unrelated.prepared);
  const unrelatedBinding = readEnteredModelCall(unrelatedEntered);
  const unrelatedHandle = prepareModelCallRecovery(unrelatedEntered, { ...f.accounting, owner: unrelatedBinding.authority }, unrelated.attribution);
  let finishUnrelated!: () => void;
  observeModelCallRecovery(unrelatedEntered, new Promise<void>((resolve) => { finishUnrelated = resolve; }));
  const result = f.wait();
  await f.project(); f.complete();
  expect(await result).toBe("known");
  expect(f.store.modelAccountingRepository.readAttemptReceipt({ owner: unrelatedBinding.authority,
    physicalId: unrelated.attribution.physicalId, attributionSha256: unrelated.attribution.contentSha256 }).state).toBe("pending");
  const cancelled = new AbortController(); cancelled.abort();
  expect(await awaitModelCallRecovery({ handle: unrelatedHandle, attribution: unrelated.attribution,
    signal: cancelled.signal, deadlineAt: Date.now() + 5_000 })).toBe("cancelled");
  finishUnrelated();
  expect(f.source.pending()).toEqual([]);
  expect(await f.main()).toHaveProperty("prepared");
});

it("does not retry when durable detection publication consumes the remaining native recovery grace", async () => {
  const f = await fixture();
  await f.project(); f.complete();
  vi.useFakeTimers();
  const createSource = vi.fn(async () => {
    const source = createAssistantMessageEventStream();
    source.push({ type: "done", reason: "stop", message: { ...f.fixture.message,
      content: [fauxThinking("Inspect the repository next.")] } });
    return { source, context: f.fixture.context, options: {}, recovery: () => ({ handle: f.handle, attribution: f.call.attribution }) };
  });
  const actions: string[] = [];
  const stream = guardModelThinkingLoop({ model: f.fixture.model, context: f.fixture.context, options: {},
    rootSignal: new AbortController().signal, nativeAccounting: true, remainingMs: () => 30_000, createSource,
    onDetected: (_evidence, action, _message, _trace, recovery) => {
      actions.push(`${action}:${recovery?.readiness}`);
      if (action === "retry") vi.setSystemTime(Date.now() + 5_001);
      return action;
    },
  });
  for await (const _event of stream) { /* Bounded final response. */ }
  expect(createSource).toHaveBeenCalledOnce();
  expect(actions).toEqual(["retry:known", "finalize:pending_timeout"]);
});

it("rejects missing, forged and stale handles and cannot issue one from a forged entered capability", async () => {
  const f = await fixture();
  const base = { attribution: f.call.attribution, signal: new AbortController().signal, deadlineAt: Date.now() + 5_000 };
  expect(await awaitModelCallRecovery({ ...base, handle: undefined })).toBe("invalid_handle");
  expect(await awaitModelCallRecovery({ ...base, handle: {} as ModelCallRecoveryHandle })).toBe("invalid_handle");
  expect(await awaitModelCallRecovery({ ...base, handle: f.handle,
    attribution: { ...f.call.attribution, physicalId: "physical_stale" } })).toBe("invalid_handle");
  expect(() => prepareModelCallRecovery({} as typeof f.entered, f.accounting, f.call.attribution)).toThrow("native dispatch authority");
  f.complete();
});

it("interrupts pending readiness on root abort and enforces elapsed grace before timer callbacks run", async () => {
  const f = await fixture(), abort = new AbortController();
  const cancelled = f.wait(abort.signal); abort.abort();
  expect(await cancelled).toBe("cancelled");
  await f.project();
  vi.useFakeTimers();
  const deadline = Date.now() + 5_000, expired = f.wait(undefined, deadline);
  vi.setSystemTime(deadline + 1); f.complete();
  expect(await expired).toBe("pending_timeout");
});

it.each([undefined, {} as ModelCallRecoveryHandle])("native guard fails closed when completion handle is %s", async (handle) => {
  const f = await fixture();
  const createSource = vi.fn(async () => {
    const source = createAssistantMessageEventStream();
    const message = { ...fauxAssistantMessage([fauxThinking("Inspect the repository next.")]),
      api: f.fixture.model.api, provider: f.fixture.model.provider, model: f.fixture.model.id };
    source.push({ type: "done", reason: "stop", message });
    return { source, context: { messages: [] }, options: {}, recovery: () => ({
      ...(handle ? { handle } : {}), attribution: f.call.attribution }) };
  });
  const detected = vi.fn((..._args: unknown[]) => "retry" as const);
  const stream = guardModelThinkingLoop({ model: f.fixture.model, context: { messages: [] }, options: {},
    rootSignal: new AbortController().signal, nativeAccounting: true, createSource, onDetected: detected });
  for await (const _event of stream) { /* Consume bounded error. */ }
  expect(createSource).toHaveBeenCalledOnce();
  expect(detected.mock.calls[0]?.[1]).toBe("finalize");
  expect((await stream.result()).stopReason).toBe("error");
  f.complete();
});

it("expires the existing five-second grace without completing or replacing the physical call", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const result = f.wait();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await result).toBe("pending_timeout");
  f.complete();
});

it.each([true, false])("consumer close settles the isolated logical attempt exactly once (child callback=%s)", async (child) => {
  const f = modelUsageFixture(), raw = createAssistantMessageEventStream(), cancelled = vi.fn(), settled = vi.fn(async () => undefined);
  const stream = guardModelThinkingLoop({ model: f.model, context: f.context, options: {},
    rootSignal: new AbortController().signal,
    createSource: async ({ signal }) => {
      signal.addEventListener("abort", cancelled, { once: true });
      const source = createCancellableModelStream({ models: { streamSimple: () => raw }, remainingMs: () => 30_000 },
        f.model, f.context, { signal });
      raw.push({ type: "text_delta", contentIndex: 0, delta: "Visible prefix", partial: f.message });
      return { source, context: f.context, options: {}, logicalResult: () => source.result(),
        ...(child ? { settleLogical: settled } : {}) };
    }, onDetected: () => "finalize",
  });
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.type).toBe("text_delta");
  await iterator.return?.();
  expect(cancelled).toHaveBeenCalledOnce();
  expect((await stream.result()).stopReason).toBe("aborted");
  expect(settled).toHaveBeenCalledTimes(child ? 1 : 0);
  raw.push({ type: "done", reason: "stop", message: f.message });
  expect((await stream.result()).stopReason).toBe("aborted");
});
