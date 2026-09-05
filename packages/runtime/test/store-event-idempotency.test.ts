import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LEDGER_DATABASE_FILENAME, LocalStore } from "../src/index.js";
import { ConcurrentRunEventHeadError } from "../src/sqlite-ledger-errors.js";

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

async function createOptions() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-event-once-"));
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

async function createRun(store: LocalStore) {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Atomic event idempotency",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  return { thread, run };
}

function inspectedEventInput(threadId: string, runId: string) {
  return {
    threadId,
    runId,
    type: "workspace.inspected" as const,
    category: "artifact" as const,
    visibility: "user" as const,
    payload: { status: "completed" },
  };
}

describe("LocalStore.appendEventOnce", () => {
  it("appends exactly one event across concurrent calls", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);

    const events = await Promise.all(
      Array.from({ length: 32 }, () =>
        store.appendEventOnce(inspectedEventInput(thread.id, run.id), {
          namespace: "run.progress.vector",
          key: "turn_completed_seq:17",
        }),
      ),
    );

    expect(new Set(events.map((event) => event.id))).toEqual(
      new Set([events[0]!.id]),
    );
    expect(events.every((event) => event.seq === 1)).toBe(true);
    expect(await store.listEvents(thread.id)).toEqual([events[0]]);
    expect(store.getThread(thread.id).eventCount).toBe(1);

    const database = new DatabaseSync(
      path.join(options.dataRoot, LEDGER_DATABASE_FILENAME),
    );
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ledger_event_idempotency
         WHERE thread_id = ? AND run_id = ?`,
      )
      .get(thread.id, run.id) as { count: number };
    database.close();
    expect(row.count).toBe(1);
  });

  it("serializes one winner across independent LocalStore instances", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const second = await openStore(options);
    const { thread, run } = await createRun(first);
    const input = inspectedEventInput(thread.id, run.id);
    const key = {
      namespace: "run.progress.decision",
      key: "decision_sha256:abc123",
    } as const;

    const events = await Promise.all([
      first.appendEventOnce(input, key),
      second.appendEventOnce(input, key),
    ]);

    expect(events[1]).toEqual(events[0]);
    expect(await first.listEvents(thread.id)).toEqual([events[0]]);
    expect(await second.listEvents(thread.id)).toEqual([events[0]]);
    expect(first.getThread(thread.id).eventCount).toBe(1);
    expect(second.getThread(thread.id).eventCount).toBe(1);
  });

  it("preserves the idempotency binding across SQLite restart and legacy JSON recovery", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const { thread, run } = await createRun(first);
    const input = inspectedEventInput(thread.id, run.id);
    const key = {
      namespace: "run.progress.directive",
      key: "directive_sha256:def456",
    } as const;
    const original = await first.appendEventOnce(input, key);
    await first.shutdown();
    openStores.splice(openStores.indexOf(first), 1);

    const restarted = await openStore(options);
    expect(await restarted.appendEventOnce(input, key)).toEqual(original);
    await restarted.shutdown();
    openStores.splice(openStores.indexOf(restarted), 1);

    const projection = await readFile(
      path.join(options.dataRoot, "events", `${thread.id}.jsonl`),
      "utf8",
    );
    expect(projection).toContain(
      '"idempotency":{"namespace":"run.progress.directive","key":"directive_sha256:def456"}',
    );

    for (const suffix of ["", "-shm", "-wal"]) {
      await rm(
        path.join(options.dataRoot, `${LEDGER_DATABASE_FILENAME}${suffix}`),
        { force: true },
      );
    }
    const recovered = await openStore(options);
    expect(await recovered.appendEventOnce(input, key)).toEqual(original);
    expect(
      (await recovered.listEvents(thread.id)).filter(
        (event) => event.type === "workspace.inspected",
      ),
    ).toEqual([original]);
  });

  it("rejects an idempotency key reused for different semantic content", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);
    const key = {
      namespace: "run.progress.vector",
      key: "projection:conflict",
    } as const;
    const original = inspectedEventInput(thread.id, run.id);
    const committed = await store.appendEventOnce(original, key);

    await expect(
      store.appendEventOnce(
        {
          ...original,
          payload: { ...original.payload, status: "different" },
        },
        key,
      ),
    ).rejects.toThrow("Ledger event idempotency conflict");
    expect(await store.listEvents(thread.id)).toEqual([committed]);
    expect(store.getThread(thread.id).eventCount).toBe(1);
  });
});

describe("LocalStore.appendEventOnceAtRunHead", () => {
  it("commits at the expected Run head and reports canonical replays", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);
    const input = inspectedEventInput(thread.id, run.id);
    const idempotency = {
      namespace: "run.operation.admission",
      key: "operation_a:admitted",
    } as const;

    const committed = await store.appendEventOnceAtRunHead(input, {
      ...idempotency,
      expectedRunHeadSeq: 0,
    });
    const replayed = await store.appendEventOnceAtRunHead(input, {
      ...idempotency,
      expectedRunHeadSeq: 0,
    });

    expect(committed.appended).toBe(true);
    expect(replayed).toEqual({ event: committed.event, appended: false });
    expect(await store.listRunEvents(run.id)).toEqual([committed.event]);
    expect(store.getThread(thread.id).eventCount).toBe(1);
  });

  it("rejects a stale Run head without appending or hiding the actual head", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);
    const existing = await store.appendEvent(
      inspectedEventInput(thread.id, run.id),
    );

    const append = store.appendEventOnceAtRunHead(
      inspectedEventInput(thread.id, run.id),
      {
        namespace: "run.operation.admission",
        key: "operation_b:admitted",
        expectedRunHeadSeq: 0,
      },
    );

    await expect(append).rejects.toMatchObject({
      name: "ConcurrentRunEventHeadError",
      runId: run.id,
      expectedRunHeadSeq: 0,
      actualRunHeadSeq: existing.seq,
    });
    expect(await store.listRunEvents(run.id)).toEqual([existing]);
    expect(store.getThread(thread.id).eventCount).toBe(1);
  });

  it("allows only one independent writer to claim the same Run head", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const second = await openStore(options);
    const { thread, run } = await createRun(first);
    const input = inspectedEventInput(thread.id, run.id);

    const results = await Promise.allSettled([
      first.appendEventOnceAtRunHead(input, {
        namespace: "run.operation.admission",
        key: "operation_c:first",
        expectedRunHeadSeq: 0,
      }),
      second.appendEventOnceAtRunHead(input, {
        namespace: "run.operation.admission",
        key: "operation_c:second",
        expectedRunHeadSeq: 0,
      }),
    ]);

    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<LocalStore["appendEventOnceAtRunHead"]>>
      > => result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]!.value.appended).toBe(true);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConcurrentRunEventHeadError);
    expect(await first.listRunEvents(run.id)).toEqual([
      fulfilled[0]!.value.event,
    ]);
  });

  it("commits independent Thread lanes without global revision retries", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const second = await openStore(options);
    const firstRun = await createRun(first);
    const secondRun = await createRun(first);
    const firstFailures = first.getPersistenceMetrics().failedCommitCount;
    const secondFailures = second.getPersistenceMetrics().failedCommitCount;

    const [left, right] = await Promise.all([
      first.appendEventOnceAtRunHead(
        inspectedEventInput(firstRun.thread.id, firstRun.run.id),
        {
          namespace: "run.operation.admission",
          key: "operation_independent:first",
          expectedRunHeadSeq: 0,
        },
      ),
      second.appendEventOnceAtRunHead(
        inspectedEventInput(secondRun.thread.id, secondRun.run.id),
        {
          namespace: "run.operation.admission",
          key: "operation_independent:second",
          expectedRunHeadSeq: 0,
        },
      ),
    ]);

    expect([left, right].every((result) => result.appended)).toBe(true);
    expect(left.event.seq).toBe(1);
    expect(right.event.seq).toBe(1);
    expect(first.getPersistenceMetrics().failedCommitCount).toBe(firstFailures);
    expect(second.getPersistenceMetrics().failedCommitCount).toBe(
      secondFailures,
    );
    expect(first.getThread(secondRun.thread.id).eventCount).toBe(1);
    expect(second.getThread(firstRun.thread.id).eventCount).toBe(1);
  });

  it("allocates one Thread sequence across independent Runs without retrying", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const second = await openStore(options);
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Shared Thread sequence",
      agentId: agent.id,
    });
    const earlierRun = await first.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    await first.finishRun(earlierRun.id, "completed");
    const laterRun = await first.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const firstFailures = first.getPersistenceMetrics().failedCommitCount;
    const secondFailures = second.getPersistenceMetrics().failedCommitCount;

    const results = await Promise.all([
      first.appendEventOnceAtRunHead(
        inspectedEventInput(thread.id, earlierRun.id),
        {
          namespace: "run.operation.admission",
          key: "operation_shared_thread:earlier",
          expectedRunHeadSeq: 0,
        },
      ),
      second.appendEventOnceAtRunHead(
        inspectedEventInput(thread.id, laterRun.id),
        {
          namespace: "run.operation.admission",
          key: "operation_shared_thread:later",
          expectedRunHeadSeq: 0,
        },
      ),
    ]);

    expect(results.map((result) => result.event.seq).sort()).toEqual([1, 2]);
    expect(first.getPersistenceMetrics().failedCommitCount).toBe(firstFailures);
    expect(second.getPersistenceMetrics().failedCommitCount).toBe(
      secondFailures,
    );
    expect(
      (await first.listEvents(thread.id)).map((event) => event.seq),
    ).toEqual([1, 2]);
    expect(first.getThread(thread.id).eventCount).toBe(2);
    expect(second.getThread(thread.id).eventCount).toBe(2);
    expect(await first.listRunEvents(earlierRun.id)).toHaveLength(1);
    expect(await second.listRunEvents(laterRun.id)).toHaveLength(1);
  });

  it("does not treat another Run's event as a conflicting head", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);
    const other = await createRun(store);
    await store.appendEvent(inspectedEventInput(other.thread.id, other.run.id));

    const result = await store.appendEventOnceAtRunHead(
      inspectedEventInput(thread.id, run.id),
      {
        namespace: "run.operation.admission",
        key: "operation_d:admitted",
        expectedRunHeadSeq: 0,
      },
    );

    expect(result.appended).toBe(true);
    expect(result.event.seq).toBe(1);
    expect(await store.listRunEvents(run.id)).toEqual([result.event]);
  });

  it("rejects invalid head cursors before mutating the projection", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const { thread, run } = await createRun(store);

    await expect(
      store.appendEventOnceAtRunHead(inspectedEventInput(thread.id, run.id), {
        namespace: "run.operation.admission",
        key: "operation_e:admitted",
        expectedRunHeadSeq: -1,
      }),
    ).rejects.toThrow("non-negative safe integer");
    expect(await store.listRunEvents(run.id)).toEqual([]);
    expect(store.getThread(thread.id).eventCount).toBe(0);
  });
});
