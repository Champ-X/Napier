import { rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import type { ModelAccountingHost } from "../src/model-accounting-host.js";
import { canonicalJson } from "../src/ed25519.js";
import { issueModelUndispatchedDriverProof } from "../src/model-call-attribution.js";
import { createUndispatchedModelObservation } from "../src/model-usage-observation.js";
import { accountingFixture } from "./model-accounting-fixture.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close(); fixture.source.close(); await rm(fixture.root, { recursive: true, force: true });
  }
});
async function fixture() { const f = await accountingFixture(); fixtures.push(f); return f; }
async function reopen(f: Awaited<ReturnType<typeof fixture>>) {
  const store = new LocalStore(f.options); stores.push(store); await store.initializeAccounting();
  store.modelAccountingRepository.configureSource({ source: f.source }); return store;
}
function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
  try { return { revision: Number(db.prepare("SELECT revision FROM workspace_state").get()!.revision),
    claims: Number(db.prepare("SELECT count(*) AS n FROM model_usage_claims").get()!.n),
    events: Number(db.prepare("SELECT count(*) AS n FROM ledger_events WHERE event_type='model.usage.reconciled'").get()!.n) }; }
  finally { db.close(); }
}
function persistent(detail: Awaited<ReturnType<LocalStore["getDetail"]>>) {
  return canonicalJson({ thread: detail.thread, runs: detail.runs, subagents: detail.subagents, events: detail.events });
}

describe("coherent duplicate accounting response", () => {
  it.each(["run", "child"] as const)("uses the committed %s and parent revisions after another Store settles beyond queue refresh", async (kind) => {
    const f = await fixture(), child = kind === "child" ? await f.child() : undefined;
    const call = child ? await child.prepare() : await f.main(), physical = await f.physical(call), other = await reopen(f);
    const host = other as unknown as ModelAccountingHost, runId = child?.child.run.id ?? f.parent.run.id;
    const stale = host.mutableRun(runId).accounting!.revision;
    const refresh = host.refreshStateFromLedger.bind(host);
    let committed: Awaited<ReturnType<typeof f.store.modelAccountingRepository.reconcile>> | undefined;
    let expectedRun = 0, expectedParent: number | undefined, persisted = "", nativeCounts = counts(f);
    // An actual other Store commit runs after the queue's heap refresh and before
    // the coherent attempt read; no native claim, snapshot or fold is mocked.
    const refreshSpy = vi.spyOn(host, "refreshStateFromLedger")
      .mockImplementationOnce((force) => refresh(force))
      .mockImplementationOnce(async (force) => {
        refresh(force);
        committed = await f.store.modelAccountingRepository.reconcile(physical.delivery);
        if (child) {
          // A separate parent call advances only the parent's current revision.
          // The duplicate result must use the coherent snapshot, not the first
          // receipt's event revision or a stale child/parent heap combination.
          const parentCall = await f.main(), parentPhysical = await f.physical(parentCall);
          await f.store.modelAccountingRepository.reconcile(parentPhysical.delivery);
          expectedParent = (await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).accountingRevision;
        }
        expectedRun = (await f.store.modelAccountingRepository.readRunAccounting(runId)).accountingRevision;
        nativeCounts = counts(f); persisted = persistent(await f.store.getDetail(f.thread.id));
      });
    const result = await other.modelAccountingRepository.reconcile(physical.delivery);
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(refreshSpy.mock.calls.every(([force]) => force !== true)).toBe(true);
    expect(host.mutableRun(runId).accounting!.revision).toBe(stale);
    expect(expectedRun).toBeGreaterThan(stale);
    expect(result).toEqual({ outcome: "duplicate", physicalId: call.attribution.physicalId,
      receiptSha256: physical.observation.contentSha256, accountingRevision: expectedRun,
      ...(child ? { parentAccountingRevision: expectedParent } : {}) });
    if (child) expect(expectedParent).toBeGreaterThan(committed!.parentAccountingRevision!);
    expect(counts(f)).toEqual(nativeCounts);
    expect(persistent(await other.getDetail(f.thread.id))).toBe(persisted);
    console.info(JSON.stringify({ case: kind, stale, accountingRevision: result.accountingRevision,
      parentAccountingRevision: result.parentAccountingRevision, nativeCounts }));
  });

  it.each(["run", "child"] as const)("uses the coherent snapshot for an already-undispatched %s without forcing heap reload", async (kind) => {
    const f = await fixture(), child = kind === "child" ? await f.child() : undefined;
    const call = child ? await child.prepare() : await f.main(), proof = issueModelUndispatchedDriverProof(call.prepared);
    const other = await reopen(f), host = f.store as unknown as ModelAccountingHost;
    const runId = child?.child.run.id ?? f.parent.run.id, stale = host.mutableRun(runId).accounting!.revision;
    f.source.reserve(call.attribution);
    f.source.record(createUndispatchedModelObservation(call.attribution, proof));
    const delivery = f.source.pending({ physicalId: call.attribution.physicalId })[0]!;
    const committed = await other.modelAccountingRepository.reconcile(delivery);
    const before = counts(f), persisted = persistent(await other.getDetail(f.thread.id));
    // Model a commit immediately after assertInitialized's refresh: the matching
    // native claim is current while the receiving Store's heap is still stale.
    const refreshSpy = vi.spyOn(host, "refreshStateFromLedger").mockImplementationOnce(() => undefined);
    const result = await f.store.modelAccountingRepository.rejectUndispatched(proof, "before_dispatch");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(host.mutableRun(runId).accounting!.revision).toBe(stale);
    expect(committed.accountingRevision).toBeGreaterThan(stale);
    expect(result).toEqual({ ...committed, outcome: "duplicate" });
    expect(counts(f)).toEqual(before);
    expect(persistent(await f.store.getDetail(f.thread.id))).toBe(persisted);
    console.info(JSON.stringify({ case: `undispatched-${kind}`, stale, accountingRevision: result.accountingRevision,
      parentAccountingRevision: result.parentAccountingRevision, nativeCounts: before }));
  });
});
