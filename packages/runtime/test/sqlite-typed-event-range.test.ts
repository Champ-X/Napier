import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteLedger } from "../src/sqlite-ledger.js";

const roots: string[] = [];
const ledgers: SqliteLedger[] = [];
afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function event(seq: number, type: string, threadId = "thread_target"): RunEvent {
  return { id: `${threadId}_${seq}`, threadId, runId: `${threadId}_run_${seq % 3}`, seq, type,
    category: "model", visibility: "debug", createdAt: new Date(seq * 1000).toISOString(),
    payload: { text: `${threadId}:${seq}` } };
}
async function fixture(events: RunEvent[]) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-typed-range-")); roots.push(root);
  const databasePath = path.join(root, "ledger.sqlite");
  const ledger = new SqliteLedger(databasePath); ledgers.push(ledger); ledger.initialize();
  ledger.bootstrap('{"runs":[]}', events);
  return { ledger, databasePath };
}

describe("SQLite typed thread ranges", () => {
  it("matches complete replay for inclusive ranges and normalized 0/1/2/64 type sets in both readers", async () => {
    const types = Array.from({ length: 64 }, (_, i) => `type_${i}`);
    types[63] = "type_' OR 1=1 --";
    const source = Array.from({ length: 128 }, (_, i) => event(i + 1, types[i % types.length]!));
    const foreign = Array.from({ length: 128 }, (_, i) => event(i + 1, types[i % types.length]!, "thread_foreign"));
    const { ledger } = await fixture([...source, ...foreign]);
    const reader = ledger.eventReader();
    const sets = [undefined, [], [types[0]!], [types[3]!, types[1]!],
      [types[1]!, types[3]!, types[1]!], types, [...types].reverse(), ["missing", types[63]!]];
    for (const [from, to] of [[1, 128], [32, 96], [64, 64], [200, Number.MAX_SAFE_INTEGER]]) {
      for (const selected of sets) {
        const expected = source.filter((item) => item.seq >= from! && item.seq <= to! &&
          (selected === undefined || selected.includes(item.type)));
        expect(ledger.listEventsRange("thread_target", from!, to!, selected)).toEqual(expected);
        expect(await reader.listEventsRange("thread_target", from!, to!, selected)).toEqual(expected);
      }
    }
  });

  it("retains detached values, argument limits and fresh async reads after a committed append", async () => {
    const { ledger } = await fixture([event(1, "type_a"), event(2, "type_b")]);
    const reader = ledger.eventReader();
    const selected = ["type_b", "type_a", "type_b"];
    const result = await reader.listEventsRange("thread_target", 1, 99, selected);
    result[0]!.payload = { text: "mutated" };
    result.reverse();
    expect(ledger.listEventsRange("thread_target", 1, 99, selected)).toEqual([event(1, "type_a"), event(2, "type_b")]);
    ledger.commitEvents(ledger.readSnapshot()!.revision, event(3, "type_a"));
    expect(await reader.listEventsRange("thread_target", 1, 99, selected))
      .toEqual([event(1, "type_a"), event(2, "type_b"), event(3, "type_a")]);
    expect(() => ledger.listEventsRange("thread_target", 1, 99, Array(65).fill("type_a"))).toThrow("at most 64");
    expect(() => reader.listEventsRange("thread_target", 1, 99, Array(65).fill("type_a"))).toThrow("at most 64");
    expect(() => ledger.listEventsRange("thread_target", 2, 1, selected)).toThrow("fromSeq <= toSeq");
    expect(() => reader.listEventsRange("thread_target", 2, 1, selected)).toThrow("fromSeq <= toSeq");
  });

  it("keeps all type branches inside the native read transaction snapshot", async () => {
    const { ledger, databasePath } = await fixture([event(1, "type_a"), event(2, "type_b")]);
    const writer = new SqliteLedger(databasePath); ledgers.push(writer); writer.initialize();
    ledger.readTransaction(() => {
      const before = ledger.listEventsRange("thread_target", 1, 99, ["type_a", "type_b"]);
      writer.commitEvents(writer.readSnapshot()!.revision, event(3, "type_b"));
      expect(ledger.listEventsRange("thread_target", 1, 99, ["type_b", "type_a"])).toEqual(before);
    });
    expect(ledger.listEventsRange("thread_target", 1, 99, ["type_a", "type_b"]))
      .toEqual([event(1, "type_a"), event(2, "type_b"), event(3, "type_b")]);
  });
});
