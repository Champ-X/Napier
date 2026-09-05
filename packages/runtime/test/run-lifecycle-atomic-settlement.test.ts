import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("atomic Run lifecycle settlement", () => {
  it("commits terminal event, interaction cancellation, and Run/Thread state in one revision", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    await store.queueRunControlMessage({
      threadId,
      runId,
      mode: "steering",
      text: "A queued instruction that settlement must cancel.",
    });
    await store.requestOperatorDecision({
      threadId,
      runId,
      header: "Continue?",
      question: "Should this Run continue?",
      options: [
        { label: "Yes", description: "Continue." },
        { label: "No", description: "Stop." },
      ],
      multiSelect: false,
    });
    const beforeRevision = durableRevision(store);
    const observedAtEmit: Array<{ status: string; terminalCount: number }> = [];

    await store.finishRun(runId, "completed", {
      outcome: "completed",
      terminalEvent: {
        visibility: "debug",
        payload: { status: "completed", outcome: "completed" },
      },
      onTerminalEvent: async () => {
        observedAtEmit.push({
          status: store.listRuns(threadId).find((run) => run.id === runId)!
            .status,
          terminalCount: (await store.listRunEvents(runId)).filter(
            (event) => event.type === "run.completed",
          ).length,
        });
      },
    });

    const events = await store.listRunEvents(runId);
    expect(durableRevision(store)).toBe(beforeRevision + 1);
    expect(events.map((event) => event.type).slice(-3)).toEqual([
      "run.completed",
      "run.control.cancelled",
      "operator.decision.cancelled",
    ]);
    expect(store.listRuns(threadId).find((run) => run.id === runId)).toEqual(
      expect.objectContaining({ status: "completed", outcome: "completed" }),
    );
    expect(store.getThread(threadId)).toEqual(
      expect.objectContaining({ status: "idle" }),
    );
    expect(store.getThread(threadId)).not.toHaveProperty("currentRunId");
    expect(observedAtEmit).toEqual([{ status: "completed", terminalCount: 1 }]);
  });

  it("rolls back the terminal event when snapshot persistence fails and emits nothing", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    const database = sqliteDatabase(store);
    database.exec(`
      CREATE TEMP TRIGGER reject_atomic_run_settlement
      BEFORE UPDATE ON workspace_state
      BEGIN
        SELECT RAISE(ABORT, 'forced atomic settlement failure');
      END;
    `);
    const onTerminalEvent = vi.fn();

    await expect(
      store.finishRun(runId, "failed", {
        error: "expected rollback",
        terminalEvent: {
          visibility: "user",
          payload: { status: "failed", message: "expected rollback" },
        },
        onTerminalEvent,
      }),
    ).rejects.toThrow("forced atomic settlement failure");

    expect(await store.listRunEvents(runId)).toEqual([]);
    expect(
      store.listRuns(threadId).find((run) => run.id === runId)?.status,
    ).toBe("running");
    expect(onTerminalEvent).not.toHaveBeenCalled();

    database.exec("DROP TRIGGER reject_atomic_run_settlement");
    await store.finishRun(runId, "failed", {
      error: "retry succeeded",
      terminalEvent: {
        visibility: "user",
        payload: { status: "failed", message: "retry succeeded" },
      },
      onTerminalEvent,
    });
    expect(onTerminalEvent).toHaveBeenCalledTimes(1);
    expect(
      (await store.listRunEvents(runId)).filter(
        (event) => event.type === "run.failed",
      ),
    ).toHaveLength(1);
  });

  it("allows only one conflicting atomic terminal settlement across Stores", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);

    const outcomes = await Promise.allSettled([
      first.finishRun(runId, "completed", {
        terminalEvent: {
          visibility: "debug",
          payload: { status: "completed" },
        },
      }),
      second.finishRun(runId, "failed", {
        error: "competing failure",
        terminalEvent: {
          visibility: "user",
          payload: { status: "failed", message: "competing failure" },
        },
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const terminalEvents = (await first.listRunEvents(runId)).filter((event) =>
      ["run.completed", "run.failed"].includes(event.type),
    );
    expect(terminalEvents).toHaveLength(1);
    const durable = await openStore(first.dataRoot, first.workspaceRoot);
    const run = durable
      .listRuns(threadId)
      .find((candidate) => candidate.id === runId);
    expect(run?.status).toBe(
      terminalEvents[0]!.type === "run.completed" ? "completed" : "failed",
    );
  });

  it("preserves the legacy append-then-finish path without duplicating its terminal event", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    const original = await store.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });
    const onTerminalEvent = vi.fn();

    await store.finishRun(runId, "completed", {
      terminalEvent: {
        visibility: "debug",
        payload: { status: "completed" },
      },
      onTerminalEvent,
    });

    expect(
      (await store.listRunEvents(runId)).filter(
        (event) => event.type === "run.completed",
      ),
    ).toEqual([original]);
    expect(
      store.listRuns(threadId).find((run) => run.id === runId)?.status,
    ).toBe("completed");
    expect(onTerminalEvent).not.toHaveBeenCalled();
  });

  it("rolls back startup interruption evidence with its lifecycle snapshot", async () => {
    const initial = await openStore();
    const { threadId, runId } = await createRun(initial);
    const dataRoot = initial.dataRoot;
    const workspaceRoot = initial.workspaceRoot;
    sqliteDatabase(initial).exec(`
      CREATE TRIGGER reject_startup_interruption
      BEFORE UPDATE ON workspace_state
      BEGIN
        SELECT RAISE(ABORT, 'forced startup interruption failure');
      END;
    `);
    initial.close();

    await expect(openStore(dataRoot, workspaceRoot, true)).rejects.toThrow(
      "forced startup interruption failure",
    );
    const database = new DatabaseSync(path.join(dataRoot, "ledger.sqlite"));
    const eventCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM ledger_events
         WHERE run_id = ? AND event_type = 'run.interrupted'`,
      )
      .get(runId) as { count: number };
    const snapshot = database
      .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
      .get() as { state_json: string };
    const state = JSON.parse(snapshot.state_json) as {
      runs: Array<{ id: string; status: string }>;
    };
    expect(eventCount.count).toBe(0);
    expect(state.runs.find((run) => run.id === runId)?.status).toBe("running");
    database.exec("DROP TRIGGER reject_startup_interruption");
    database.close();

    const reopened = await openStore(dataRoot, workspaceRoot, true);
    expect(
      reopened.listRuns(threadId).find((run) => run.id === runId)?.status,
    ).toBe("interrupted");
    expect(
      (await reopened.listRunEvents(runId)).filter(
        (event) => event.type === "run.interrupted",
      ),
    ).toHaveLength(1);
  });
});

async function openStore(
  dataRoot?: string,
  workspaceRoot?: string,
  interruptActiveRuns = false,
): Promise<LocalStore> {
  const root = dataRoot
    ? undefined
    : await mkdtemp(path.join(tmpdir(), "napier-atomic-settle-"));
  if (root) roots.push(root);
  const resolvedWorkspace = workspaceRoot ?? path.join(root!, "workspace");
  if (root) await mkdir(resolvedWorkspace);
  const store = new LocalStore({
    dataRoot: dataRoot ?? path.join(root!, "data"),
    workspaceRoot: resolvedWorkspace,
  });
  stores.push(store);
  await store.initialize(interruptActiveRuns);
  return store;
}

async function createRun(
  store: LocalStore,
): Promise<{ threadId: string; runId: string }> {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Atomic lifecycle settlement",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
    model: { provider: "faux", id: "faux-1" },
  });
  return { threadId: thread.id, runId: run.id };
}

function durableRevision(store: LocalStore): number {
  return (
    store as unknown as { ledger: { readSnapshot(): { revision: number } } }
  ).ledger.readSnapshot().revision;
}

function sqliteDatabase(store: LocalStore): DatabaseSync {
  return (store as unknown as { ledger: { database: DatabaseSync } }).ledger
    .database;
}
