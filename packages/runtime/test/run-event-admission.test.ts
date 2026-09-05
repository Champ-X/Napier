import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  durableTerminalRunStatus,
  RunEventAdmissionError,
  RunTerminalEventConflictError,
} from "../src/run-event-admission.js";
import { listRunEventSchemas } from "../src/run-event-registry.js";
import { RUN_TRANSITION_DEFINITIONS } from "../src/run-state-machine.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Run event admission", () => {
  it("projects the first terminal fence by sequence even from reversed replay input", () => {
    const terminalEvents = [
      {
        threadId: "thread_ordered_terminal",
        runId: "run_ordered_terminal",
        seq: 9,
        type: "run.failed",
      },
      {
        threadId: "thread_ordered_terminal",
        runId: "run_ordered_terminal",
        seq: 4,
        type: "run.completed",
      },
    ];

    expect(
      durableTerminalRunStatus(
        terminalEvents,
        "thread_ordered_terminal",
        "run_ordered_terminal",
      ),
    ).toBe("completed");
    expect(
      durableTerminalRunStatus(
        [...terminalEvents].reverse(),
        "thread_ordered_terminal",
        "run_ordered_terminal",
      ),
    ).toBe("completed");
  });

  it("keeps terminal-transition admission aligned with the Run state machine", () => {
    const registered = listRunEventSchemas()
      .filter((schema) => schema.admission === "terminal_transition")
      .map((schema) => schema.type)
      .sort();
    const transitions = [
      ...new Set(
        RUN_TRANSITION_DEFINITIONS.filter(
          (transition) =>
            transition.to !== "queued" && transition.to !== "running",
        ).map((transition) => transition.durableEvent),
      ),
    ].sort();

    expect(registered).toEqual(transitions);
  });

  it("accepts active Run events and omits the admission request from the Ledger", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);

    const event = await store.appendEvent({
      threadId,
      runId,
      type: "model.text.delta",
      category: "model",
      visibility: "hidden",
      payload: { delta: "active" },
      admission: "run_active",
    });

    expect(event).toEqual(
      expect.objectContaining({
        seq: 1,
        type: "model.text.delta",
        payload: { delta: "active" },
      }),
    );
    expect(event).not.toHaveProperty("admission");
  });

  it("rejects a stale writer after another Store terminates the Run", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);
    const before = second.getPersistenceMetrics();

    await first.finishRun(runId, "completed");

    await expect(
      second.appendEvent({
        threadId,
        runId,
        type: "model.text.delta",
        category: "model",
        visibility: "hidden",
        payload: { delta: "late" },
        admission: "run_active",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );

    expect(second.getPersistenceMetrics().commitCount).toBe(before.commitCount);
    expect(second.getThread(threadId).eventCount).toBe(0);
    expect(await second.listEvents(threadId)).toEqual([]);
  });

  it("preserves explicit retrospective audit events after Run termination", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    await store.finishRun(runId, "cancelled");

    await expect(
      store.appendEvent({
        threadId,
        runId,
        type: "model.stream.cancellation_failed",
        category: "model",
        visibility: "debug",
        payload: { status: "observed" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        seq: 1,
        type: "model.stream.cancellation_failed",
      }),
    );
  });

  it("treats a durable terminal event as an immediate in-memory execution fence", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);

    await store.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });

    expect(
      store.listRuns(threadId).find((run) => run.id === runId)?.status,
    ).toBe("running");
    await expect(
      store.appendEvent({
        threadId,
        runId,
        type: "model.text.delta",
        category: "model",
        visibility: "hidden",
        payload: { delta: "late" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
    await expect(
      store.appendEvent({
        threadId,
        runId,
        type: "model.stream.cancellation_failed",
        category: "model",
        visibility: "debug",
        payload: { status: "observed" },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ type: "model.stream.cancellation_failed" }),
    );
  });

  it("applies the terminal fence to registered batch mutations", async () => {
    const store = await openStore();
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Terminal batch admission",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux", id: "faux-1" },
    });
    await store.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });

    await expect(
      store.queueRunControlMessage({
        threadId: thread.id,
        runId: run.id,
        mode: "steering",
        text: "This must not be queued beyond the terminal fence.",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
    expect(
      (await store.listRunEvents(run.id)).some(
        (event) => event.type === "run.control.queued",
      ),
    ).toBe(false);
  });

  it("rejects a second terminal outcome while the Run snapshot is still active", async () => {
    const store = await openStore();
    const { threadId, runId } = await createRun(store);
    await store.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });

    await expect(
      store.appendEvent({
        threadId,
        runId,
        type: "run.failed",
        category: "lifecycle",
        visibility: "user",
        payload: { status: "failed", message: "late failure" },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunTerminalEventConflictError>>({
        name: "RunTerminalEventConflictError",
        requestedStatus: "failed",
        existingStatus: "completed",
      }),
    );
  });

  it("allows only one terminal outcome across independent Stores", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);

    const outcomes = await Promise.allSettled([
      first.appendEvent({
        threadId,
        runId,
        type: "run.completed",
        category: "lifecycle",
        visibility: "debug",
        payload: { status: "completed" },
      }),
      second.appendEvent({
        threadId,
        runId,
        type: "run.failed",
        category: "lifecycle",
        visibility: "user",
        payload: { status: "failed", message: "concurrent failure" },
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (await first.listRunEvents(runId)).filter((event) =>
        [
          "run.completed",
          "run.failed",
          "run.cancelled",
          "run.interrupted",
        ].includes(event.type),
      ),
    ).toHaveLength(1);
  });

  it("rejects a fresh SQLite Run-head claim behind a terminal event while replaying an old claim", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);
    const original = await first.appendEventOnceAtRunHead(
      {
        threadId,
        runId,
        type: "tool.admitted",
        category: "tool",
        payload: { callId: "call_before_terminal", toolName: "read_file" },
      },
      {
        namespace: "terminal-fence",
        key: "original",
        expectedRunHeadSeq: 0,
      },
    );
    const terminal = await first.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });

    await expect(
      second.appendEventOnceAtRunHead(
        {
          threadId,
          runId,
          type: "tool.admitted",
          category: "tool",
          payload: { callId: "call_before_terminal", toolName: "read_file" },
        },
        {
          namespace: "terminal-fence",
          key: "original",
          expectedRunHeadSeq: terminal.seq,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ appended: false, event: original.event }),
    );
    await expect(
      second.appendEventOnceAtRunHead(
        {
          threadId,
          runId,
          type: "tool.admitted",
          category: "tool",
          payload: { callId: "call_after_terminal", toolName: "read_file" },
        },
        {
          namespace: "terminal-fence",
          key: "fresh",
          expectedRunHeadSeq: terminal.seq,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
  });

  it("resolves ordinary idempotent replay before the terminal fence across stale Stores", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);
    const input = {
      threadId,
      runId,
      type: "model.text.delta" as const,
      category: "model" as const,
      visibility: "hidden" as const,
      payload: { delta: "before-terminal" },
    };
    const idempotency = {
      namespace: "terminal-fence-ordinary-once",
      key: "original",
    } as const;
    const original = await first.appendEventOnce(input, idempotency);
    await first.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });

    await expect(second.appendEventOnce(input, idempotency)).resolves.toEqual(
      original,
    );
    await expect(
      second.appendEventOnce(
        { ...input, payload: { delta: "after-terminal" } },
        {
          namespace: "terminal-fence-ordinary-once",
          key: "fresh",
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
  });

  it("repairs an active snapshot from durable terminal evidence on reopen", async () => {
    const first = await openStore();
    const { threadId, runId } = await createRun(first);
    const replayInput = {
      threadId,
      runId,
      type: "model.text.delta" as const,
      category: "model" as const,
      visibility: "hidden" as const,
      payload: { delta: "durable-before-crash" },
    };
    const replayKey = {
      namespace: "terminal-fence-restart",
      key: "original",
    } as const;
    const original = await first.appendEventOnce(replayInput, replayKey);
    await first.appendEvent({
      threadId,
      runId,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const reopened = await openStore(first.dataRoot, first.workspaceRoot);

    expect(reopened.listRuns(threadId).find((run) => run.id === runId)).toEqual(
      expect.objectContaining({ status: "completed" }),
    );
    expect(reopened.getThread(threadId).status).toBe("idle");
    expect(reopened.getThread(threadId).currentRunId).toBeUndefined();
    await expect(
      reopened.appendEventOnce(replayInput, replayKey),
    ).resolves.toEqual(original);
    expect(
      (await reopened.listRunEvents(runId)).filter((event) =>
        [
          "run.completed",
          "run.failed",
          "run.cancelled",
          "run.interrupted",
        ].includes(event.type),
      ),
    ).toHaveLength(1);
  });

  it("preserves the pending operator decision named by terminal recovery evidence", async () => {
    const first = await openStore();
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Terminal operator recovery",
      agentId: agent.id,
    });
    const run = await first.createRun({
      threadId: thread.id,
      agentId: agent.id,
      model: { provider: "faux", id: "faux-1" },
    });
    const requested = await first.requestOperatorDecision({
      threadId: thread.id,
      runId: run.id,
      header: "Continue?",
      question: "Choose how this Run should continue.",
      options: [
        { label: "Continue", description: "Resume with the current scope." },
        { label: "Stop", description: "Leave the Run stopped." },
      ],
      multiSelect: false,
    });
    await first.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.waiting_for_operator",
      category: "lifecycle",
      visibility: "user",
      payload: {
        status: "waiting",
        operatorDecisionId: requested.decision.id,
      },
    });
    await first.appendEvent({
      threadId: thread.id,
      runId: run.id,
      type: "run.completed",
      category: "lifecycle",
      visibility: "debug",
      payload: { status: "completed" },
    });
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const reopened = await openStore(first.dataRoot, first.workspaceRoot);

    expect(reopened.getThread(thread.id).status).toBe("waiting");
    expect(await reopened.listOperatorDecisions(thread.id, run.id)).toEqual([
      expect.objectContaining({
        id: requested.decision.id,
        status: "pending",
      }),
    ]);
    expect(
      (await reopened.listRunEvents(run.id)).some(
        (event) => event.type === "operator.decision.cancelled",
      ),
    ).toBe(false);
  });

  it("rejects centrally classified execution claims after Run termination", async () => {
    const first = await openStore();
    const second = await openStore(first.dataRoot, first.workspaceRoot);
    const { threadId, runId } = await createRun(first);

    const original = await first.appendEventOnceAtRunHead(
      {
        threadId,
        runId,
        type: "tool.admitted",
        category: "tool",
        payload: { callId: "call_original", toolName: "write_file" },
      },
      {
        namespace: "test-run-admission",
        key: "original-tool-claim",
        expectedRunHeadSeq: 0,
      },
    );
    await first.finishRun(runId, "completed");

    await expect(
      first.appendEventOnceAtRunHead(
        {
          threadId,
          runId,
          type: "tool.admitted",
          category: "tool",
          payload: { callId: "call_original", toolName: "write_file" },
        },
        {
          namespace: "test-run-admission",
          key: "original-tool-claim",
          expectedRunHeadSeq: original.event.seq,
        },
      ),
    ).resolves.toEqual(expect.objectContaining({ appended: false }));
    await expect(
      second.appendEventOnceAtRunHead(
        {
          threadId,
          runId,
          type: "tool.admitted",
          category: "tool",
          payload: { callId: "call_original", toolName: "write_file" },
        },
        {
          namespace: "test-run-admission",
          key: "original-tool-claim",
          expectedRunHeadSeq: original.event.seq,
        },
      ),
    ).resolves.toEqual(expect.objectContaining({ appended: false }));

    await expect(
      second.appendEventOnceAtRunHead(
        {
          threadId,
          runId,
          type: "tool.admitted",
          category: "tool",
          payload: { callId: "call_late", toolName: "write_file" },
        },
        {
          namespace: "test-run-admission",
          key: "late-tool-claim",
          expectedRunHeadSeq: original.event.seq,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<RunEventAdmissionError>>({
        name: "RunEventAdmissionError",
        status: "completed",
      }),
    );
  });
});

async function openStore(
  dataRoot?: string,
  workspaceRoot?: string,
): Promise<LocalStore> {
  if (!dataRoot || !workspaceRoot) {
    const root = await mkdtemp(path.join(tmpdir(), "napier-run-admission-"));
    roots.push(root);
    dataRoot = path.join(root, "data");
    workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
  }
  const store = new LocalStore({ dataRoot, workspaceRoot });
  stores.push(store);
  await store.initialize();
  return store;
}

async function createRun(
  store: LocalStore,
): Promise<{ threadId: string; runId: string }> {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Run event admission",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  return { threadId: thread.id, runId: run.id };
}
