import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";

const temporaryRoots: string[] = [];
const openStores: LocalStore[] = [];

afterEach(async () => {
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Store compatibility projections", () => {
  it("recovers uncheckpointed events from SQLite and flushes explicitly", async () => {
    const options = await storeOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    const runId = first.getThread(thread.id).runIds[0]!;
    const eventPath = threadEventPath(options.dataRoot, thread.id);
    const beforeState = await workspaceProjection(options.dataRoot);
    const beforeEvents = await readFile(eventPath, "utf8");
    const beforeLedger = ledgerSnapshot(options.dataRoot);

    await first.appendEvent({
      threadId: thread.id,
      runId,
      type: "message.user",
      category: "message",
      payload: { role: "user", text: "Tail replay message." },
    });
    const afterLedger = ledgerSnapshot(options.dataRoot);
    expect(afterLedger.revision).toBe(beforeLedger.revision + 1);
    expect(afterLedger.snapshotRevision).toBe(beforeLedger.snapshotRevision);
    expect(afterLedger.stateJson).toBe(beforeLedger.stateJson);
    expect(first.getPersistenceMetrics().last!.stateBytes).toBe(0);
    expect(await workspaceProjection(options.dataRoot)).toBe(beforeState);
    expect(await readFile(eventPath, "utf8")).toBe(beforeEvents);
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const reopened = await openStore(options);
    expect(reopened.getThread(thread.id).eventCount).toBe(4);
    expect(reopened.getThread(thread.id).lastMessage).toBe(
      "Tail replay message.",
    );
    expect((await reopened.listEvents(thread.id)).at(-1)?.type).toBe(
      "message.user",
    );
    await reopened.flushCompatibilityProjections();
    const state = JSON.parse(await workspaceProjection(options.dataRoot)) as {
      threads: Array<{ id: string; eventCount: number }>;
    };
    expect(
      state.threads.find((candidate) => candidate.id === thread.id)?.eventCount,
    ).toBe(4);
    expect((await projectedEventTypes(eventPath)).at(-1)).toBe("message.user");
  });

  it("checkpoints every dirty Thread at a turn boundary", async () => {
    const options = await storeOptions();
    const store = await openStore(options);
    const firstThread = store.listThreads()[0]!;
    const firstRunId = store.getThread(firstThread.id).runIds[0]!;
    const secondThread = await store.createThread({
      title: "Second compatibility Thread",
      agentId: store.listAgents()[0]!.id,
    });
    const secondRun = await store.createRun({
      threadId: secondThread.id,
      agentId: secondThread.agentId,
    });
    await store.appendEvent({
      threadId: firstThread.id,
      runId: firstRunId,
      type: "checkpoint.first_pending",
      category: "system",
      payload: {},
    });
    await store.appendEvent({
      threadId: secondThread.id,
      runId: secondRun.id,
      type: "checkpoint.second_pending",
      category: "system",
      payload: {},
    });
    const before = store.getPersistenceMetrics();
    const beforeLedger = ledgerSnapshot(options.dataRoot);

    await store.appendEvent({
      threadId: secondThread.id,
      runId: secondRun.id,
      type: "turn.completed",
      category: "lifecycle",
      payload: {},
    });
    const after = store.getPersistenceMetrics();
    const afterLedger = ledgerSnapshot(options.dataRoot);

    expect(afterLedger.revision).toBe(beforeLedger.revision + 1);
    expect(afterLedger.snapshotRevision).toBe(afterLedger.revision);
    expect(afterLedger.stateJson).not.toBe(beforeLedger.stateJson);
    const checkpointState = JSON.parse(afterLedger.stateJson) as {
      threads: Array<{ id: string; eventCount: number }>;
    };
    expect(
      checkpointState.threads.find(
        (candidate) => candidate.id === firstThread.id,
      )?.eventCount,
    ).toBe(store.getThread(firstThread.id).eventCount);
    expect(
      checkpointState.threads.find(
        (candidate) => candidate.id === secondThread.id,
      )?.eventCount,
    ).toBe(store.getThread(secondThread.id).eventCount);
    expect(after.last!.stateProjectionBytes).toBeGreaterThan(0);
    expect(after.last!.eventProjectionBytes).toBeGreaterThan(0);
    expect(after.last!.projectionFailureCount).toBe(0);
    expect(after.projectionBytesWritten).toBeGreaterThan(
      before.projectionBytesWritten,
    );
    expect(
      await projectedEventTypes(
        threadEventPath(options.dataRoot, firstThread.id),
      ),
    ).toContain("checkpoint.first_pending");
    expect(
      (
        await projectedEventTypes(
          threadEventPath(options.dataRoot, secondThread.id),
        )
      ).slice(-2),
    ).toEqual(["checkpoint.second_pending", "turn.completed"]);
  });

  it("checkpoints at the bounded event interval without a semantic boundary", async () => {
    const options = await storeOptions();
    const store = await openStore(options);
    const thread = store.listThreads()[0]!;
    const runId = store.getThread(thread.id).runIds[0]!;
    const eventPath = threadEventPath(options.dataRoot, thread.id);

    for (let seq = 4; seq <= 64; seq += 1) {
      await store.appendEvent({
        threadId: thread.id,
        runId,
        type: "checkpoint.interval_event",
        category: "system",
        payload: { seq },
      });
    }

    expect((await projectedEventTypes(eventPath)).length).toBe(64);
    expect(
      (
        JSON.parse(ledgerSnapshot(options.dataRoot).stateJson) as {
          threads: Array<{ id: string; eventCount: number }>;
        }
      ).threads.find((candidate) => candidate.id === thread.id)?.eventCount,
    ).toBe(64);
    expect(store.getPersistenceMetrics().last).toEqual(
      expect.objectContaining({
        eventCount: 1,
        stateProjectionBytes: expect.any(Number),
        eventProjectionBytes: expect.any(Number),
      }),
    );
    expect(
      store.getPersistenceMetrics().last!.stateProjectionBytes,
    ).toBeGreaterThan(0);
    expect(
      store.getPersistenceMetrics().last!.eventProjectionBytes,
    ).toBeGreaterThan(0);
  });

  it("appends only the authoritative JSONL suffix at later checkpoints", async () => {
    const options = await storeOptions();
    const store = await openStore(options);
    const thread = store.listThreads()[0]!;
    const runId = store.getThread(thread.id).runIds[0]!;
    const eventPath = threadEventPath(options.dataRoot, thread.id);

    await store.appendEvent({
      threadId: thread.id,
      runId,
      type: "turn.completed",
      category: "lifecycle",
      payload: {},
    });
    const firstContents = await readFile(eventPath);
    const firstStat = await stat(eventPath);
    await store.appendEvent({
      threadId: thread.id,
      runId,
      type: "checkpoint.incremental_pending",
      category: "system",
      payload: {},
    });
    await store.appendEvent({
      threadId: thread.id,
      runId,
      type: "turn.completed",
      category: "lifecycle",
      payload: {},
    });
    const secondContents = await readFile(eventPath);
    const secondStat = await stat(eventPath);
    const appended = secondContents
      .subarray(firstContents.length)
      .toString("utf8");

    expect(secondStat.ino).toBe(firstStat.ino);
    expect(secondContents.subarray(0, firstContents.length)).toEqual(
      firstContents,
    );
    expect(
      appended
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { type: string }).type),
    ).toEqual(["checkpoint.incremental_pending", "turn.completed"]);
    expect(store.getPersistenceMetrics().last!.eventProjectionBytes).toBe(
      Buffer.byteLength(appended),
    );
  });

  it("serializes concurrent checkpoint appenders without duplicate JSONL rows", async () => {
    const options = await storeOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    const runId = first.getThread(thread.id).runIds[0]!;
    const second = await openStore(options);

    await Promise.all([
      first.appendEvent({
        threadId: thread.id,
        runId,
        type: "turn.completed",
        category: "lifecycle",
        payload: { writer: "first" },
      }),
      second.appendEvent({
        threadId: thread.id,
        runId,
        type: "turn.completed",
        category: "lifecycle",
        payload: { writer: "second" },
      }),
    ]);

    const events = await first.listEvents(thread.id);
    const projected = await projectedEvents(
      threadEventPath(options.dataRoot, thread.id),
    );
    expect(projected.map((event) => event.seq)).toEqual(
      events.map((event) => event.seq),
    );
    expect(projected).toEqual(events);
  });

  it("fails closed when an existing JSONL tail drifts from SQLite", async () => {
    const options = await storeOptions();
    const store = await openStore(options);
    const thread = store.listThreads()[0]!;
    const runId = store.getThread(thread.id).runIds[0]!;
    const eventPath = threadEventPath(options.dataRoot, thread.id);
    const contents = await readFile(eventPath, "utf8");
    const lines = contents.trim().split("\n");
    const tail = JSON.parse(lines.at(-1)!) as { payload: unknown };
    tail.payload = { drifted: true };
    lines[lines.length - 1] = JSON.stringify(tail);
    await writeFile(eventPath, `${lines.join("\n")}\n`, "utf8");

    await store.appendEvent({
      threadId: thread.id,
      runId,
      type: "turn.completed",
      category: "lifecycle",
      payload: {},
    });

    expect(store.getPersistenceMetrics().last).toEqual(
      expect.objectContaining({
        projectionFailureCount: 1,
        eventProjectionBytes: 0,
      }),
    );
    await expect(store.flushCompatibilityProjections()).rejects.toThrow(
      "Compatibility projection flush failed",
    );
  });

  it("rejects snapshot event-count drift instead of replaying an unproved tail", async () => {
    const options = await storeOptions();
    const store = await openStore(options);
    const thread = store.listThreads()[0]!;
    await store.appendEvent({
      threadId: thread.id,
      runId: store.getThread(thread.id).runIds[0]!,
      type: "checkpoint.pending",
      category: "system",
      payload: {},
    });
    store.close();
    openStores.splice(openStores.indexOf(store), 1);

    const database = new DatabaseSync(
      path.join(options.dataRoot, LEDGER_DATABASE_FILENAME),
    );
    const snapshot = database
      .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
      .get() as { state_json: string };
    const state = JSON.parse(snapshot.state_json) as {
      threads: Array<{ id: string; eventCount: number }>;
    };
    state.threads.find((candidate) => candidate.id === thread.id)!.eventCount -=
      1;
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(state));
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "SQLite ledger snapshot tail mismatch",
    );
  });

  it("serializes alternating event-only writers through revision CAS", async () => {
    const options = await storeOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    const runId = first.getThread(thread.id).runIds[0]!;
    const second = await openStore(options);
    const before = ledgerSnapshot(options.dataRoot);

    const events = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? first : second).appendEvent({
          threadId: thread.id,
          runId,
          type: "checkpoint.concurrent",
          category: "system",
          payload: { index },
        }),
      ),
    );
    const after = ledgerSnapshot(options.dataRoot);

    expect(
      events.map((event) => event.seq).sort((left, right) => left - right),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 4));
    expect(after.revision).toBe(before.revision + 20);
    expect(after.snapshotRevision).toBe(before.snapshotRevision);
    expect(after.stateJson).toBe(before.stateJson);
    expect(first.getThread(thread.id).eventCount).toBe(23);
    expect(second.getThread(thread.id).eventCount).toBe(23);
  });
});

async function storeOptions() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-projections-"));
  temporaryRoots.push(root);
  return {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
}

async function openStore(options: {
  dataRoot: string;
  workspaceRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(options);
  openStores.push(store);
  await store.initialize();
  return store;
}

function workspaceProjection(dataRoot: string): Promise<string> {
  return readFile(path.join(dataRoot, "workspace.json"), "utf8");
}

function threadEventPath(dataRoot: string, threadId: string): string {
  return path.join(dataRoot, "events", `${threadId}.jsonl`);
}

async function projectedEventTypes(eventPath: string): Promise<string[]> {
  return (await projectedEvents(eventPath)).map((event) => event.type);
}

async function projectedEvents(
  eventPath: string,
): Promise<Array<Record<string, unknown> & { seq: number; type: string }>> {
  return (await readFile(eventPath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as Record<string, unknown> & {
          seq: number;
          type: string;
        },
    );
}

function ledgerSnapshot(dataRoot: string): {
  revision: number;
  snapshotRevision: number;
  stateJson: string;
} {
  const database = new DatabaseSync(
    path.join(dataRoot, LEDGER_DATABASE_FILENAME),
  );
  try {
    const row = database
      .prepare(
        `SELECT revision, snapshot_revision, state_json
         FROM workspace_state
         WHERE singleton = 1`,
      )
      .get() as {
      revision: number;
      snapshot_revision: number;
      state_json: string;
    };
    return {
      revision: row.revision,
      snapshotRevision: row.snapshot_revision,
      stateJson: row.state_json,
    };
  } finally {
    database.close();
  }
}
