import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { EventCategory, RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { LEDGER_SCHEMA_VERSION, SqliteLedger } from "../src/sqlite-ledger.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const ledgers: SqliteLedger[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite Run event query port", () => {
  it("queries Runs, inclusive ranges, and latest typed events", async () => {
    const { ledger } = await createLedger([
      event(1, "run_a", "message.user", "message"),
      event(2, "run_b", "message.user", "message"),
      event(3, "run_a", "model.response", "model"),
      event(4, "run_a", "message.assistant", "message"),
    ]);

    expect(ledger.listRunEvents("run_a").map((item) => item.seq)).toEqual([
      1, 3, 4,
    ]);
    expect(
      ledger
        .listRunEvents("run_a", 1, ["message.assistant", "model.response"])
        .map((item) => item.seq),
    ).toEqual([3, 4]);
    expect(ledger.listRunEvents("run_a", 0, [])).toEqual([]);
    expect(
      ledger.listEventsRange("thread_a", 2, 3).map((item) => item.seq),
    ).toEqual([2, 3]);
    expect(
      ledger
        .listEventsRange("thread_a", 1, 4, ["message.user"])
        .map((item) => item.seq),
    ).toEqual([1, 2]);
    expect(
      ledger.findLatestEvent({
        runId: "run_a",
        types: ["message.user", "message.assistant"],
      })?.seq,
    ).toBe(4);
  });

  it("finds terminal tool calls and correlation groups without fuzzy matches", async () => {
    const { ledger } = await createLedger([
      event(1, "run_a", "tool.started", "tool", {
        callId: "call_1",
        correlationId: "corr_1",
      }),
      event(2, "run_a", "tool.completed", "tool", {
        callId: "call_10",
        correlationId: "corr_1",
      }),
      event(3, "run_a", "tool.failed", "tool", {
        callId: "call_1",
        correlationId: "corr_1",
      }),
      event(4, "run_b", "tool.blocked", "tool", {
        callId: "call_1",
        correlationId: "corr_2",
      }),
    ]);

    expect(ledger.findToolTerminal("call_1", { runId: "run_a" })?.seq).toBe(3);
    expect(ledger.findToolTerminal("call_1", { runId: "missing" })).toBe(
      undefined,
    );
    expect(
      ledger
        .listEventsByCorrelationId("corr_1", {
          threadId: "thread_a",
          types: ["tool.started", "tool.failed"],
        })
        .map((item) => item.seq),
    ).toEqual([1, 3]);
    expect(ledger.listEventsByCorrelationId("missing")).toEqual([]);
  });

  it("executes scoped queries through the independent read worker", async () => {
    const { ledger } = await createLedger([
      event(1, "run_a", "message.user", "message"),
      event(2, "run_a", "tool.completed", "tool", {
        callId: "call_1",
        correlationId: "corr_1",
      }),
      event(3, "run_b", "tool.failed", "tool", {
        callId: "call_1",
        correlationId: "corr_1",
      }),
      event(4, "run_a", "message.assistant", "message"),
    ]);
    const reader = ledger.eventReader();

    await expect(
      reader.findLatestEvent({
        runId: "run_a",
        afterSeq: 1,
        atOrBeforeSeq: 4,
        types: ["message.assistant", "message.assistant"],
      }),
    ).resolves.toEqual(expect.objectContaining({ seq: 4 }));
    await expect(
      reader.findToolTerminal("call_1", { runId: "run_a" }),
    ).resolves.toEqual(expect.objectContaining({ seq: 2 }));
    await expect(
      reader.listEventsByCorrelationId("corr_1", {
        threadId: "thread_a",
        afterSeq: 1,
        types: ["tool.completed", "tool.failed"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ seq: 2 }),
      expect.objectContaining({ seq: 3 }),
    ]);

    ledger.close();
    ledgers.splice(ledgers.indexOf(ledger), 1);
    await expect(reader.listEvents("thread_a")).rejects.toThrow(
      "SQLite read worker is closed",
    );
  });

  it("validates query bounds and returns isolated event values", async () => {
    const { ledger } = await createLedger([
      event(1, "run_a", "message.user", "message", { text: "original" }),
    ]);

    expect(() => ledger.listEventsRange("thread_a", 2, 1)).toThrow(
      "fromSeq <= toSeq",
    );
    expect(() => ledger.listRunEvents("run_a", -1)).toThrow("afterSeq");
    expect(() => ledger.findLatestEvent({})).toThrow("Thread ID or Run ID");

    const result = ledger.listRunEvents("run_a");
    (result[0]!.payload as { text: string }).text = "mutated";
    expect(ledger.listRunEvents("run_a")[0]!.payload).toEqual({
      text: "original",
    });
  });

  it("records v5 and creates every targeted query index", async () => {
    const { ledger, databasePath } = await createLedger([]);
    expect(ledger.schemaReport()).toEqual(
      expect.objectContaining({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        migrations: expect.arrayContaining([
          expect.objectContaining({
            version: 5,
            name: "indexed_event_queries",
          }),
        ]),
      }),
    );
    ledger.close();
    ledgers.splice(ledgers.indexOf(ledger), 1);

    const database = new DatabaseSync(databasePath);
    database.exec(`
      DROP INDEX ledger_events_run_type_seq;
      DROP INDEX ledger_events_thread_type_seq;
      DROP INDEX ledger_events_correlation_seq;
      DROP INDEX ledger_events_call_terminal_seq;
      DELETE FROM ledger_schema_migrations WHERE version = 5;
      PRAGMA user_version = 4;
    `);
    database.close();
    const migrated = new SqliteLedger(databasePath);
    ledgers.push(migrated);
    migrated.initialize();
    expect(migrated.schemaReport()).toEqual(
      expect.objectContaining({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        migrations: expect.arrayContaining([
          expect.objectContaining({
            version: 5,
            name: "indexed_event_queries",
          }),
        ]),
      }),
    );
    migrated.close();
    ledgers.splice(ledgers.indexOf(migrated), 1);

    const inspected = new DatabaseSync(databasePath);
    const indexes = inspected
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ledger_events' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    inspected.close();
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "ledger_events_run",
        "ledger_events_run_type_seq",
        "ledger_events_thread_type_seq",
        "ledger_events_correlation_seq",
        "ledger_events_call_terminal_seq",
      ]),
    );
  });

  it("exposes isolated queries and complete Run usage through LocalStore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-run-query-store-"));
    roots.push(root);
    const store = new LocalStore({
      dataRoot: path.join(root, "data"),
      workspaceRoot: path.join(root, "workspace"),
    });
    stores.push(store);
    await store.initialize();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Run query integration",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "model.response",
      category: "model",
      visibility: "debug",
      payload: {
        usage: {
          inputTokens: 11,
          outputTokens: 7,
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
          costUsd: 0.25,
        },
      },
    });
    const task = await store.createSubagentTask({
      threadId: thread.id,
      runId: run.id,
      role: "reviewer",
      description: "Review query behavior",
      prompt: "Verify the query read model.",
      model: { provider: "faux", id: "faux-1" },
    });
    await store.finishSubagentTask(task.id, {
      status: "completed",
      stopReason: "completed",
      usage: {
        inputTokens: 5,
        outputTokens: 4,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        costUsd: 0.5,
      },
    });

    expect(
      await store.listRunEvents(run.id, 0, ["model.response"]),
    ).toHaveLength(1);
    expect(await store.aggregateRunUsage(run.id)).toEqual({
      inputTokens: 16,
      outputTokens: 11,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      costUsd: 0.75,
    });
    await expect(store.listRunEvents("missing_run")).rejects.toThrow(
      "Run not found",
    );
  });
});

async function createLedger(events: RunEvent[]): Promise<{
  ledger: SqliteLedger;
  databasePath: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-query-"));
  roots.push(root);
  const databasePath = path.join(root, "ledger.sqlite");
  const ledger = new SqliteLedger(databasePath);
  ledgers.push(ledger);
  ledger.initialize();
  ledger.bootstrap('{"runs":[]}', events);
  return { ledger, databasePath };
}

function event(
  seq: number,
  runId: string,
  type: string,
  category: EventCategory,
  payload: Record<string, string> = {},
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_a",
    runId,
    seq,
    type,
    category,
    visibility: "debug",
    createdAt: new Date(seq * 1_000).toISOString(),
    payload,
  };
}
