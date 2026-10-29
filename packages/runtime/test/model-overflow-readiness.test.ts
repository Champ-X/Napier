import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { accountingFixture } from "./model-accounting-fixture.js";
import { readEnteredModelCall } from "../src/model-call-attribution.js";
import { prepareModelCallRecovery, observeModelCallRecovery } from "../src/model-call-recovery.js";
import { recoverModelContextOverflow, type ModelContextOverflowDecision } from "../src/model-context-overflow-recovery.js";
import { projectPendingModelUsage } from "../src/model-usage-projection.js";
import { MODEL_STREAM_CANCELLATION_GRACE_MS } from "../src/model-stream-transport.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(cleanup.splice(0).map((close) => close())); });
async function fixture(remainingMs: (() => number) | null = () => 1_000) {
  const f = await accountingFixture();
  cleanup.push(async () => { f.store.close(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  const call = await f.main(), entered = await f.store.modelAccountingRepository.enter(call.prepared);
  const { authority } = readEnteredModelCall(entered);
  const handle = prepareModelCallRecovery(entered, { repository: f.store.modelAccountingRepository,
    owner: authority, logicalCallId: call.attribution.logicalCallId }, call.attribution);
  let done!: () => void, fail!: (error: unknown) => void;
  observeModelCallRecovery(entered, new Promise<void>((resolve, reject) => { done = resolve; fail = reject; }));
  f.fixture.message.stopReason = "error"; f.fixture.message.errorMessage = "context_length_exceeded";
  const raw = createAssistantMessageEventStream();
  raw.push({ type: "error", reason: "error", error: f.fixture.message });
  const recover = vi.fn(async () => raw), decisions: ModelContextOverflowDecision[] = [], abort = new AbortController();
  const stream = recoverModelContextOverflow({ source: raw, signal: abort.signal, nativeAccounting: true,
    ...(remainingMs ? { remainingMs } : {}), recovery: () => ({ handle, attribution: call.attribution }),
    onOverflow: async (_error, decision) => { decisions.push(decision); }, recover });
  const consume = async () => { for await (const _event of stream) { /* Observe only its final error. */ } };
  return { ...f, call, done, fail, abort, decisions, recover, stream, consume };
}

it("does not authorize overflow recovery from a Store claim when source ACK fails", async () => {
  const f = await fixture(), observed = f.consume();
  const physical = await f.physical(f.call, false);
  await f.store.modelAccountingRepository.reconcile(physical.delivery);
  expect(f.decisions).toEqual([]); expect(f.recover).not.toHaveBeenCalled();
  const db = new DatabaseSync(f.sourcePath);
  try {
    db.exec("CREATE TRIGGER reject_overflow_ack BEFORE UPDATE OF acknowledged_at ON model_usage_receipts BEGIN SELECT RAISE(ABORT,'overflow ACK failure'); END");
    await projectPendingModelUsage(f.source, f.store.modelAccountingRepository).then(f.done, f.fail);
    await observed;
    expect(f.decisions).toEqual([{ action: "finalize", readiness: "accounting_failed" }]);
    expect(f.source.pending()).toHaveLength(1); expect(f.recover).not.toHaveBeenCalled();
    db.exec("DROP TRIGGER reject_overflow_ack");
    await projectPendingModelUsage(f.source, f.store.modelAccountingRepository);
    expect(f.source.pending()).toHaveLength(0); expect(f.recover).not.toHaveBeenCalled();
  } finally { db.exec("DROP TRIGGER IF EXISTS reject_overflow_ack"); db.close(); }
});

it.each(["missing", "infinite", "long"] as const)("caps stalled native readiness at existing grace with %s lifetime", async (kind) => {
  const f = await fixture(kind === "missing" ? null : () => kind === "infinite" ? Infinity : 120_000);
  vi.useFakeTimers();
  const observed = f.consume();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.decisions).toEqual([]);
  await vi.advanceTimersByTimeAsync(MODEL_STREAM_CANCELLATION_GRACE_MS);
  await observed;
  expect(f.decisions).toEqual([{ action: "finalize", readiness: "pending_timeout" }]);
  expect(f.recover).not.toHaveBeenCalled();
  f.done();
});

it.each(["cancelled", "pending_timeout"] as const)("ends native overflow readiness on %s without renewing the deadline", async (reason) => {
  const f = await fixture();
  if (reason === "pending_timeout") vi.useFakeTimers();
  const observed = f.consume();
  await Promise.resolve();
  if (reason === "cancelled") f.abort.abort();
  else await vi.advanceTimersByTimeAsync(1_001);
  await observed;
  expect(f.decisions).toEqual([{ action: "finalize", readiness: reason }]);
  expect(f.recover).not.toHaveBeenCalled();
  f.done();
});
