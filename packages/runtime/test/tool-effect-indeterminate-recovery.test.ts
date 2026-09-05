import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  RunEvent,
  ToolOperationEffectIndeterminatePayloadV1,
} from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/index.js";
import { SqliteLedger } from "../src/sqlite-ledger.js";
import { EffectIndeterminateCommitError } from "../src/sqlite-effect-indeterminate-commit.js";
import { projectRunFailureCircuits } from "../src/run-failure-circuit-projection.js";
import { effectIndeterminateEventPayload } from "../src/tool-effect-indeterminate-event.js";
import { validToolOperationEventPayload } from "../src/tool-operation-event-validation.js";
import { projectSettledToolOperationProgress } from "../src/tool-operation-progress-projection.js";
import {
  DurableToolOperationJournal,
  ToolOperationFencingError,
  type ToolOperationDescriptor,
  type ToolOperationJournalStore,
} from "../src/tool-operation-journal.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("effect-indeterminate crash recovery", () => {
  it("atomically fails the Run and fences a stale owner settlement", async () => {
    const fixture = await createFixture("stale-owner");
    const task = await fixture.store.createSubagentTask({
      threadId: fixture.owner.threadId,
      runId: fixture.owner.runId,
      role: "reviewer",
      description: "Review an indeterminate effect",
      prompt: "Inspect the operation without continuing it.",
      model: { provider: "faux", id: "faux-1" },
    });
    await fixture.store.startSubagentTask(task.id);
    const operation = createOperation(fixture.store, fixture.owner);
    await operation.admit();
    await operation.started();
    await operation.effectBoundary();

    const recovered = await openStore(fixture.options, true);

    expect(
      recovered
        .listRuns(fixture.owner.threadId)
        .find((run) => run.id === fixture.owner.runId),
    ).toEqual(
      expect.objectContaining({ status: "failed", outcome: "blocked_safety" }),
    );
    expect(recovered.getThread(fixture.owner.threadId)).toEqual(
      expect.objectContaining({ status: "failed" }),
    );
    expect(
      (await recovered.getDetail(fixture.owner.threadId)).events.filter(
        (event) => event.type === "subagent.orphaned",
      ),
    ).toHaveLength(1);
    await expect(
      recovered.appendEvent({
        threadId: fixture.owner.threadId,
        runId: fixture.owner.runId,
        type: "workspace.file.mutated",
        category: "tool",
        visibility: "user",
        payload: {},
      }),
    ).rejects.toMatchObject({ name: "RunEventAdmissionError" });
    await expect(
      operation.settled({ outcome: "succeeded", effect: { changed: true } }),
    ).rejects.toBeInstanceOf(ToolOperationFencingError);
    const events = await recovered.listRunEvents(fixture.owner.runId);
    const boundary = events.findLast(
      (event) =>
        event.type === "tool.operation.lease.renewed" &&
        event.payload["executionEffectBoundary"] === true,
    )!;
    await expect(
      recovered.appendEvent({
        threadId: fixture.owner.threadId,
        runId: fixture.owner.runId,
        type: "tool.failed",
        category: "tool",
        visibility: "user",
        payload: {
          callId: boundary.payload["parentCallId"] as string,
          toolName: "apply_patch",
          status: "failed",
        },
      }),
    ).rejects.toBeInstanceOf(EffectIndeterminateCommitError);
    const snapshot = ledger(recovered).readSnapshot()!;
    expect(() =>
      ledger(recovered).commitEvents(snapshot.revision, {
        ...boundary,
        id: `event_late_renewal_${fixture.owner.runId}`,
        seq: Math.max(...events.map((event) => event.seq)) + 1,
        createdAt: new Date().toISOString(),
        idempotency: {
          namespace: "effect-indeterminate-test",
          key: `late-renewal:${fixture.owner.runId}`,
        },
      }),
    ).toThrow(EffectIndeterminateCommitError);
    for (const [type, payload] of [
      [
        "context.tool_result",
        { callId: boundary.payload["parentCallId"] as string },
      ],
      [
        "tool.result_reused",
        { targetCallId: boundary.payload["parentCallId"] as string },
      ],
      [
        "tool.execution.extension",
        {
          operationId: "operation_forged_continuation",
          parentCallId: boundary.payload["parentCallId"] as string,
        },
      ],
    ] as const) {
      expect(() =>
        ledger(recovered).commitEvents(snapshot.revision, {
          ...boundary,
          id: `event_late_${type}_${fixture.owner.runId}`,
          seq: Math.max(...events.map((event) => event.seq)) + 1,
          type,
          payload,
          createdAt: new Date().toISOString(),
          idempotency: {
            namespace: "effect-indeterminate-test",
            key: `late-attribution:${type}:${fixture.owner.runId}`,
          },
        }),
      ).toThrow(EffectIndeterminateCommitError);
    }
    expect(ledger(recovered).readSnapshot()!.revision).toBe(snapshot.revision);
    const markerIndex = events.findIndex(
      (event) => event.type === "tool.operation.effect_indeterminate",
    );
    expect(
      events.slice(markerIndex, markerIndex + 2).map((event) => event.type),
    ).toEqual(["tool.operation.effect_indeterminate", "run.failed"]);
    expect(
      events.filter((event) => event.type === "tool.operation.settled"),
    ).toHaveLength(0);
    expect(projectSettledToolOperationProgress(events).observations).toEqual(
      [],
    );
    expect(
      projectRunFailureCircuits(events, fixture.owner.runId).entries,
    ).toEqual([]);
    recovered.close();
    const replayed = await openStore(fixture.options, true);
    const replayedEvents = await replayed.listRunEvents(fixture.owner.runId);
    expect(
      replayedEvents.filter(
        (event) => event.type === "tool.operation.effect_indeterminate",
      ),
    ).toHaveLength(1);
    expect(
      replayedEvents.filter((event) => event.type === "run.failed"),
    ).toHaveLength(1);
  });

  it("interrupts a crashed read without manufacturing indeterminate effect evidence", async () => {
    const fixture = await createFixture("read-crash");
    const operation = createOperation(
      fixture.store,
      fixture.owner,
      readDescriptor(),
    );
    await operation.admit();
    await operation.started();
    fixture.store.close();

    const recovered = await openStore(fixture.options, true);

    expect(
      recovered
        .listRuns(fixture.owner.threadId)
        .find((run) => run.id === fixture.owner.runId)?.status,
    ).toBe("interrupted");
    const events = await recovered.listRunEvents(fixture.owner.runId);
    expect(events.map((event) => event.type)).toContain("run.interrupted");
    expect(events.map((event) => event.type)).not.toContain(
      "tool.operation.effect_indeterminate",
    );
  });

  it("rejects every event-only marker writer and rolls back its projection", async () => {
    const fixture = await boundaryFixture("event-only");
    const payload = await markerPayload(fixture);
    const before = ledger(fixture.store).readSnapshot()!;

    const input = {
      threadId: fixture.owner.threadId,
      runId: fixture.owner.runId,
      type: "tool.operation.effect_indeterminate" as const,
      category: "tool" as const,
      visibility: "debug" as const,
      payload,
    };
    await expect(fixture.store.appendEvent(input)).rejects.toBeInstanceOf(
      EffectIndeterminateCommitError,
    );
    await expect(
      fixture.store.appendEventOnce(input, {
        namespace: "effect-indeterminate-test",
        key: "ordinary-once",
      }),
    ).rejects.toBeInstanceOf(EffectIndeterminateCommitError);
    const head = Math.max(
      ...(await fixture.store.listRunEvents(fixture.owner.runId)).map(
        (event) => event.seq,
      ),
    );
    await expect(
      fixture.store.appendEventOnceAtRunHead(input, {
        namespace: "effect-indeterminate-test",
        key: "ordinary-head",
        expectedRunHeadSeq: head,
      }),
    ).rejects.toBeInstanceOf(EffectIndeterminateCommitError);
    const standalone: RunEvent = {
      id: `event_standalone_${fixture.owner.runId}`,
      ...input,
      seq: head + 1,
      createdAt: new Date(payload.recoveredAtMs).toISOString(),
      schemaVersion: 1,
    };
    expect(() =>
      ledger(fixture.store).commitEvents(before.revision, standalone),
    ).toThrow(EffectIndeterminateCommitError);

    expect(ledger(fixture.store).readSnapshot()!.revision).toBe(
      before.revision,
    );
    expect(
      (await fixture.store.listRunEvents(fixture.owner.runId)).some(
        (event) => event.type === "tool.operation.effect_indeterminate",
      ),
    ).toBe(false);
    expect(
      fixture.store
        .listRuns(fixture.owner.threadId)
        .find((run) => run.id === fixture.owner.runId)?.status,
    ).toBe("running");
  });

  it("rejects missing terminal evidence and a marker for the wrong generation", async () => {
    const fixture = await boundaryFixture("invalid-token");
    const context = await terminalCommitContext(fixture);
    const durable = ledger(fixture.store);

    expect(() =>
      durable.commit(context.revision, context.nextStateJson, [context.marker]),
    ).toThrow(EffectIndeterminateCommitError);

    const wrongPayload = markerWithGeneration(
      context.marker.payload as ToolOperationEffectIndeterminatePayloadV1,
      Number(context.marker.payload["executionLeaseGeneration"]) + 1,
    );
    expect(
      validToolOperationEventPayload(
        "tool.operation.effect_indeterminate",
        wrongPayload,
      ),
    ).toBe(true);
    expect(() =>
      durable.commit(context.revision, context.nextStateJson, [
        { ...context.marker, payload: wrongPayload },
        context.terminal,
      ]),
    ).toThrow(EffectIndeterminateCommitError);
    expect(durable.readSnapshot()!.revision).toBe(context.revision);

    const wrongParent = {
      ...(context.marker.payload as ToolOperationEffectIndeterminatePayloadV1),
      parentCallId: "call_forged_parent",
    };
    expect(() =>
      durable.commit(context.revision, context.nextStateJson, [
        { ...context.marker, payload: wrongParent },
        context.terminal,
      ]),
    ).toThrow(/Invalid durable tool operation event/u);
  });

  it("rejects recovery that would contradict an already-published outcome", async () => {
    const fixture = await boundaryFixture("prior-outcome");
    const payload = await markerPayload(fixture);
    await fixture.store.appendEvent({
      threadId: fixture.owner.threadId,
      runId: fixture.owner.runId,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: payload.parentCallId,
        toolName: "apply_patch",
      },
    });
    const context = await terminalCommitContext(fixture);

    expect(() =>
      ledger(fixture.store).commit(context.revision, context.nextStateJson, [
        context.marker,
        context.terminal,
      ]),
    ).toThrow(/already published a terminal outcome/u);
  });

  it("rejects a forged owner-loss decision while the process lease is live", async () => {
    const fixture = await boundaryFixture(
      "live-owner",
      `process:${String(process.pid)}:effect-indeterminate-live-owner`,
    );
    const context = await terminalCommitContext(fixture);

    expect(() =>
      ledger(fixture.store).commit(context.revision, context.nextStateJson, [
        context.marker,
        context.terminal,
      ]),
    ).toThrow(/owner lease is still preservable/u);
  });

  it("rejects a future recovery clock and rolls back startup failures", async () => {
    const forged = await boundaryFixture("future-clock");
    const future = new Date(Date.now() + 120_000).toISOString();
    const futureContext = await terminalCommitContext(forged, future);
    expect(() =>
      ledger(forged.store).commit(
        futureContext.revision,
        futureContext.nextStateJson,
        [futureContext.marker, futureContext.terminal],
      ),
    ).toThrow(EffectIndeterminateCommitError);

    const fixture = await boundaryFixture("atomic-rollback");
    sqliteDatabase(fixture.store).exec(`
      CREATE TRIGGER reject_effect_indeterminate_recovery
      BEFORE UPDATE ON workspace_state
      BEGIN
        SELECT RAISE(ABORT, 'forced effect recovery rollback');
      END;
    `);
    fixture.store.close();
    await expect(openStore(fixture.options, true)).rejects.toThrow(
      "forced effect recovery rollback",
    );
    const database = new DatabaseSync(
      path.join(fixture.options.dataRoot, "ledger.sqlite"),
    );
    const rows = database
      .prepare(
        `SELECT event_type FROM ledger_events WHERE run_id = ? AND event_type IN
          ('tool.operation.effect_indeterminate', 'run.failed')`,
      )
      .all(fixture.owner.runId) as Array<{ event_type: string }>;
    const state = JSON.parse(
      (
        database
          .prepare("SELECT state_json FROM workspace_state WHERE singleton = 1")
          .get() as { state_json: string }
      ).state_json,
    ) as { runs: Array<{ id: string; status: string }> };
    expect(rows).toEqual([]);
    expect(
      state.runs.find((run) => run.id === fixture.owner.runId)?.status,
    ).toBe("running");
    database.close();
  });

  it("rejects bootstrap/import generation of an authority-closing marker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-marker-bootstrap-"));
    roots.push(root);
    const durable = new SqliteLedger(path.join(root, "ledger.sqlite"));
    durable.initialize();
    const marker = fakeMarker();

    expect(() => durable.bootstrap('{"runs":[]}', [marker])).toThrow(
      EffectIndeterminateCommitError,
    );
    expect(durable.readSnapshot()).toBeUndefined();
    durable.close();
  });
});

async function boundaryFixture(label: string, runOwnerId?: string) {
  const fixture = await createFixture(label, runOwnerId);
  const operation = createOperation(fixture.store, fixture.owner);
  await operation.admit();
  await operation.started();
  await operation.effectBoundary();
  return fixture;
}

async function createFixture(label: string, runOwnerId?: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-effect-${label}-`));
  roots.push(root);
  const options = {
    dataRoot: path.join(root, "data"),
    workspaceRoot: path.join(root, "workspace"),
  };
  const store = await openStore(options);
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: label, agentId: agent.id });
  const leased = await store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: runOwnerId ?? `unavailable-owner-${label}`, ttlMs: 30_000 },
  );
  return {
    store,
    options,
    owner: { threadId: thread.id, runId: leased.run.id },
  };
}

async function openStore(
  options: { dataRoot: string; workspaceRoot: string },
  interruptActiveRuns = false,
): Promise<LocalStore> {
  const store = new LocalStore(options);
  stores.push(store);
  await store.initialize(interruptActiveRuns);
  return store;
}

function createOperation(
  store: ToolOperationJournalStore,
  owner: { threadId: string; runId: string },
  descriptor: ToolOperationDescriptor = writeDescriptor(),
) {
  return new DurableToolOperationJournal(store, owner, {
    executionLease: {
      ownerId: `operation-owner-${owner.runId}`,
      durationMs: 30_000,
    },
  })
    .observer(`call_${owner.runId}`)
    .operation(descriptor);
}

function writeDescriptor(): ToolOperationDescriptor {
  return {
    role: "execution_authority",
    ordinal: 1,
    mode: "mutation",
    route: "fixture",
    operation: "mutate",
    scope: "workspace",
    contribution: "product",
    resourceKey: { workspace: "fixture" },
    failureDomainKey: { tool: "fixture" },
  };
}

function readDescriptor(): ToolOperationDescriptor {
  return {
    ...writeDescriptor(),
    startedTakeover: "idempotent",
    mode: "read",
    operation: "observe",
    scope: "external",
    contribution: "supporting",
  };
}

async function markerPayload(
  fixture: Awaited<ReturnType<typeof boundaryFixture>>,
  recoveredAt = new Date().toISOString(),
): Promise<ToolOperationEffectIndeterminatePayloadV1> {
  const events = await fixture.store.listRunEvents(fixture.owner.runId);
  const boundary = events.findLast(
    (event) =>
      event.type === "tool.operation.lease.renewed" &&
      event.payload["executionEffectBoundary"] === true,
  )!;
  const run = snapshotRun(fixture.store, fixture.owner.runId);
  return effectIndeterminateEventPayload({
    boundary,
    run,
    disposition:
      Date.parse(recoveredAt) >= Date.parse(run.lease!.expiresAt)
        ? "run_lease_expired"
        : "run_owner_unavailable",
    recoveredAt,
  });
}

async function terminalCommitContext(
  fixture: Awaited<ReturnType<typeof boundaryFixture>>,
  recoveredAt = new Date().toISOString(),
) {
  const durable = ledger(fixture.store);
  const snapshot = durable.readSnapshot()!;
  const payload = await markerPayload(fixture, recoveredAt);
  const events = await fixture.store.listEvents(fixture.owner.threadId);
  const seq = Math.max(...events.map((event) => event.seq)) + 1;
  const marker: RunEvent = {
    id: `event_marker_${fixture.owner.runId}`,
    threadId: fixture.owner.threadId,
    runId: fixture.owner.runId,
    seq,
    type: "tool.operation.effect_indeterminate",
    category: "tool",
    visibility: "debug",
    createdAt: recoveredAt,
    payload,
    schemaVersion: 1,
  };
  const terminal: RunEvent = {
    ...marker,
    id: `event_terminal_${fixture.owner.runId}`,
    seq: seq + 1,
    type: "run.failed",
    category: "lifecycle",
    visibility: "user",
    payload: {
      status: "failed",
      outcome: "blocked_safety",
      reason: "effect_indeterminate",
      operationIds: [payload.operationId],
    },
  };
  return {
    revision: snapshot.revision,
    nextStateJson: failedSnapshot(snapshot.stateJson, fixture.owner.runId),
    marker,
    terminal,
  };
}

function failedSnapshot(stateJson: string, runId: string): string {
  const state = JSON.parse(stateJson) as {
    runs: Array<Record<string, unknown>>;
  };
  const run = state.runs.find((candidate) => candidate["id"] === runId)!;
  run["status"] = "failed";
  run["outcome"] = "blocked_safety";
  run["finishedAt"] = new Date().toISOString();
  delete run["lease"];
  delete run["leaseTokenSha256"];
  return JSON.stringify(state);
}

function markerWithGeneration(
  payload: ToolOperationEffectIndeterminatePayloadV1,
  generation: number,
): ToolOperationEffectIndeterminatePayloadV1 {
  const updated = { ...payload, executionLeaseGeneration: generation };
  updated.phaseStateSha256 = sha256(
    canonicalJson({
      descriptorSha256: updated.descriptorSha256,
      phase: "effect_indeterminate",
      disposition: updated.disposition,
      effectBoundaryEventSeq: updated.effectBoundaryEventSeq,
      executionLeaseOwnerSha256: updated.executionLeaseOwnerSha256,
      executionLeaseGeneration: updated.executionLeaseGeneration,
      recoveryRunLeaseBindingSha256: updated.recoveryRunLeaseBindingSha256,
      recoveryDisposition: updated.recoveryDisposition,
      recoveredAtMs: updated.recoveredAtMs,
    }),
  );
  return updated;
}

function snapshotRun(store: LocalStore, runId: string) {
  const snapshot = ledger(store).readSnapshot()!;
  const state = JSON.parse(snapshot.stateJson) as {
    runs: Array<{
      id: string;
      lease?: {
        ownerId: string;
        acquiredAt: string;
        heartbeatAt: string;
        expiresAt: string;
        revision: number;
      };
      leaseTokenSha256?: string;
    }>;
  };
  return state.runs.find((run) => run.id === runId)!;
}

function ledger(store: LocalStore): SqliteLedger {
  return (store as unknown as { ledger: SqliteLedger }).ledger;
}

function sqliteDatabase(store: LocalStore): DatabaseSync {
  return (ledger(store) as unknown as { database: DatabaseSync }).database;
}

function fakeMarker(): RunEvent {
  return {
    id: "event_fake_marker",
    threadId: "thread_fake_marker",
    runId: "run_fake_marker",
    seq: 1,
    type: "tool.operation.effect_indeterminate",
    category: "tool",
    visibility: "debug",
    createdAt: new Date().toISOString(),
    payload: {},
    schemaVersion: 1,
  };
}
