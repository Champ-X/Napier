import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent, ThreadRecord } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteLedger } from "../src/sqlite-ledger.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [], stores: LocalStore[] = [], ledgers: SqliteLedger[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-snapshot-consistency-")); roots.push(root);
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
  const initial = new LocalStore(options); stores.push(initial); await initial.initialize();
  const thread = initial.listThreads()[0]!;
  const template = (await initial.listEvents(thread.id))[0]!;
  const writer = new SqliteLedger(path.join(options.dataRoot, "ledger.sqlite")); ledgers.push(writer); writer.initialize();
  let eventCount = thread.eventCount;
  const append = (mode: "snapshot" | "event") => {
    const snapshot = writer.readSnapshot()!;
    const event: RunEvent = { ...template, id: `event_snapshot_race_${++eventCount}`, seq: eventCount,
      type: "test.snapshot-race", category: "system", payload: {} };
    if (mode === "event") writer.commitEvents(snapshot.revision, event);
    else {
      const state = JSON.parse(snapshot.stateJson) as { threads: ThreadRecord[] };
      state.threads.find((item) => item.id === thread.id)!.eventCount = eventCount;
      writer.commit(snapshot.revision, JSON.stringify(state), event);
    }
  };
  const reader = () => { const store = new LocalStore(options); stores.push(store); return store; };
  return { options, thread, writer, append, reader };
}

/** Commit from another WAL connection exactly after a reader captured its state row. */
function writeBetweenSnapshotAndProjection(f: Awaited<ReturnType<typeof fixture>>, mode: "snapshot" | "event") {
  const original = SqliteLedger.prototype.readSnapshot, seen = new Set<SqliteLedger>();
  vi.spyOn(SqliteLedger.prototype, "readSnapshot").mockImplementation(function (this: SqliteLedger) {
    const snapshot = original.call(this);
    if (snapshot && this !== f.writer && !seen.has(this)) { seen.add(this); f.append(mode); }
    return snapshot;
  });
  return seen;
}

describe("coherent LocalStore projection reads", () => {
  it.each([
    ["initialize", "snapshot"], ["initialize", "event"],
    ["initializeAccounting", "snapshot"], ["initializeAccounting", "event"],
  ] as const)("keeps two %s readers consistent across an interleaved %s commit", async (method, mode) => {
    const f = await fixture(), readers = [f.reader(), f.reader()];
    const original = SqliteLedger.prototype.listEventStats, validationCounts: number[] = [];
    vi.spyOn(SqliteLedger.prototype, "listEventStats").mockImplementation(function (this: SqliteLedger) {
      const stats = original.call(this);
      validationCounts.push(stats.find((item) => item.threadId === f.thread.id)!.count);
      return stats;
    });
    const seen = writeBetweenSnapshotAndProjection(f, mode);
    await Promise.all(readers.map((reader) => reader[method]()));
    expect(seen.size).toBe(2);
    expect(validationCounts).toEqual([f.thread.eventCount, f.thread.eventCount + 1]);
    for (const reader of readers) expect(reader.getThread(f.thread.id).eventCount).toBe(f.thread.eventCount + 2);
  });

  it.each(["initialize", "initializeAccounting"] as const)("keeps %s validation at the restored revision when a writer commits before event statistics", async (method) => {
    const f = await fixture(), readers = [f.reader(), f.reader()];
    const original = SqliteLedger.prototype.listEventStats, validationCounts: number[] = [];
    vi.spyOn(SqliteLedger.prototype, "listEventStats").mockImplementation(function (this: SqliteLedger) {
      f.append("snapshot");
      const stats = original.call(this);
      validationCounts.push(stats.find((item) => item.threadId === f.thread.id)!.count);
      return stats;
    });
    await Promise.all(readers.map((reader) => reader[method]()));
    expect(validationCounts).toEqual([f.thread.eventCount, f.thread.eventCount + 1]);
    for (const reader of readers) expect(reader.getThread(f.thread.id).eventCount).toBe(f.thread.eventCount + 2);
  });

  it("refreshes each reader using one snapshot while another connection extends the event tail", async () => {
    const f = await fixture(), readers = [f.reader(), f.reader()];
    await Promise.all(readers.map((reader) => reader.initializeAccounting()));
    f.append("event");
    const seen = writeBetweenSnapshotAndProjection(f, "event");
    expect(readers.map((reader) => reader.getThread(f.thread.id).eventCount)).toEqual([
      f.thread.eventCount + 1, f.thread.eventCount + 2,
    ]);
    expect(seen.size).toBe(2);
    for (const reader of readers) expect(reader.getThread(f.thread.id).eventCount).toBe(f.thread.eventCount + 3);
  });

  it.each(["initialize", "initializeAccounting"] as const)("still rejects real projection corruption during %s", async (method) => {
    const f = await fixture(), database = new DatabaseSync(f.writer.databasePath);
    try { database.prepare("DELETE FROM ledger_events WHERE thread_id = ? AND seq = ?").run(f.thread.id, f.thread.eventCount); }
    finally { database.close(); }
    await expect(f.reader()[method]()).rejects.toThrow(`SQLite ledger projection mismatch for ${f.thread.id}`);
  });
});
