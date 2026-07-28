import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvaluationRecord } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  compareRuns,
  createRunEvaluationGovernanceBinding,
  LEDGER_DATABASE_FILENAME,
  LEDGER_SCHEMA_VERSION,
  LocalStore,
  sha256,
} from "../src/index.js";
import { exportThreadReplayBundle } from "../src/replay.js";

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
  const root = await mkdtemp(path.join(tmpdir(), "napier-transactional-"));
  temporaryRoots.push(root);
  return {
    root,
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

async function createGovernedEvaluationInput(
  store: LocalStore,
  id: string,
): Promise<RunEvaluationRecord> {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Persisted evaluation governance",
    agentId: agent.id,
  });
  const left = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await store.finishRun(left.id, "completed");
  const right = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  await store.finishRun(right.id, "completed");
  const comparison = await compareRuns(store, thread.id, left.id, right.id);
  return {
    id,
    threadId: thread.id,
    leftRunId: left.id,
    rightRunId: right.id,
    leftSnapshotSha256: comparison.left.eventStreamSha256,
    rightSnapshotSha256: comparison.right.eventStreamSha256,
    rubric: {
      name: "Persisted governance",
      criteria: [
        {
          id: "correctness",
          name: "Correctness",
          description: "The evaluation governance binds to Run evidence.",
        },
      ],
    },
    scores: [
      {
        criterionId: "correctness",
        leftScore: 3,
        rightScore: 4,
        reason: "The candidate has stronger durable evidence.",
      },
    ],
    verdict: "right_better",
    reason: "The candidate is better supported.",
    evidence: "Compared immutable Run snapshots.",
    evaluatorModel: { provider: "faux", id: "judge-1" },
    comparisonGovernance: createRunEvaluationGovernanceBinding(
      comparison.contextCoverageDelta,
      comparison.traceSummaryBoundaryDelta,
    ),
    createdAt: "2026-07-25T08:00:00.000Z",
  };
}

function rehashComparisonGovernance(
  governance: NonNullable<RunEvaluationRecord["comparisonGovernance"]>,
): NonNullable<RunEvaluationRecord["comparisonGovernance"]> {
  const { contentSha256: _contentSha256, ...content } = governance;
  return {
    ...governance,
    contentSha256: sha256(canonicalJson(content)),
  };
}

describe("transactional LocalStore", () => {
  it("fails closed on an unsupported SQLite schema version", async () => {
    const options = await createOptions();
    await mkdir(options.dataRoot, { recursive: true });
    const database = new DatabaseSync(
      path.join(options.dataRoot, LEDGER_DATABASE_FILENAME),
    );
    database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION + 1}`);
    database.close();
    const store = new LocalStore(options);
    openStores.push(store);

    await expect(store.initialize()).rejects.toThrow(
      `Unsupported SQLite ledger schema version: ${LEDGER_SCHEMA_VERSION + 1}`,
    );
  });

  it("migrates an existing SQLite ledger to the current schema version", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    expect(first.getLedgerSchemaReport()).toEqual(
      expect.objectContaining({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        quickCheck: "ok",
        migrations: [
          expect.objectContaining({ version: 1, name: "initial_schema" }),
          expect.objectContaining({
            version: 2,
            name: "schema_migration_history",
          }),
        ],
      }),
    );
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    database.exec(`
      DROP TABLE IF EXISTS ledger_schema_migrations;
      PRAGMA user_version = 1;
    `);
    database.close();

    const migrated = await openStore(options);
    expect(migrated.getThread(thread.id).eventCount).toBe(3);
    expect(await migrated.listEvents(thread.id)).toHaveLength(3);
    expect(migrated.getLedgerSchemaReport()).toEqual(
      expect.objectContaining({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        quickCheck: "ok",
        migrations: [
          expect.objectContaining({
            version: 1,
            name: "initial_schema_backfill",
          }),
          expect.objectContaining({
            version: 2,
            name: "schema_migration_history",
          }),
        ],
      }),
    );
  });

  it("bootstraps a new workspace atomically across simultaneous instances", async () => {
    const options = await createOptions();
    const first = new LocalStore(options);
    const second = new LocalStore(options);
    openStores.push(first, second);

    await Promise.all([first.initialize(), second.initialize()]);

    const firstThread = first.listThreads()[0]!;
    const secondThread = second.listThreads()[0]!;
    expect(first.listThreads()).toHaveLength(1);
    expect(second.listThreads()).toHaveLength(1);
    expect(secondThread.id).toBe(firstThread.id);
    expect(firstThread.eventCount).toBe(3);
    expect(await second.listEvents(secondThread.id)).toHaveLength(3);
  });

  it("treats SQLite as authoritative when compatibility projections drift", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    expect(await first.listEvents(thread.id)).toHaveLength(3);
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    await writeFile(
      path.join(options.dataRoot, "workspace.json"),
      '{"corrupt":true}\n',
      "utf8",
    );

    const reopened = await openStore(options);
    expect(reopened.listThreads()).toEqual([
      expect.objectContaining({
        id: thread.id,
        eventCount: 3,
      }),
    ]);
    expect(await reopened.listEvents(thread.id)).toHaveLength(3);
  });

  it("rejects persisted evaluation governance source drift during save", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const evaluation = await createGovernedEvaluationInput(
      store,
      "evaluation_governance_save_drift",
    );
    const driftedGovernance = rehashComparisonGovernance({
      ...evaluation.comparisonGovernance!,
      contextCoverageDeltaSha256: "1".repeat(64),
    });

    await expect(
      store.saveRunEvaluation({
        ...evaluation,
        comparisonGovernance: driftedGovernance,
      }),
    ).rejects.toThrow("comparisonGovernance source binding mismatch");
  });

  it("rejects persisted evaluation snapshot source drift during save", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const evaluation = await createGovernedEvaluationInput(
      store,
      "evaluation_snapshot_save_drift",
    );

    await expect(
      store.saveRunEvaluation({
        ...evaluation,
        leftSnapshotSha256: "3".repeat(64),
      }),
    ).rejects.toThrow("snapshot source binding mismatch");
  });

  it("fails closed on persisted evaluation governance source drift during restore", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const evaluation = await first.saveRunEvaluation(
      await createGovernedEvaluationInput(
        first,
        "evaluation_governance_restore_drift",
      ),
    );
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    const state = JSON.parse(row.state_json) as {
      evaluations: RunEvaluationRecord[];
    };
    const persistedEvaluation = state.evaluations.find(
      (candidate) => candidate.id === evaluation.id,
    );
    if (!persistedEvaluation?.comparisonGovernance) {
      throw new Error("Expected persisted evaluation governance");
    }
    persistedEvaluation.comparisonGovernance = rehashComparisonGovernance({
      ...persistedEvaluation.comparisonGovernance,
      traceSummaryBoundaryDeltaSha256: "2".repeat(64),
    });
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(state));
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "comparisonGovernance source binding mismatch",
    );
  });

  it("fails closed on persisted evaluation snapshot source drift during restore", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const evaluation = await first.saveRunEvaluation(
      await createGovernedEvaluationInput(
        first,
        "evaluation_snapshot_restore_drift",
      ),
    );
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    const state = JSON.parse(row.state_json) as {
      evaluations: RunEvaluationRecord[];
    };
    const persistedEvaluation = state.evaluations.find(
      (candidate) => candidate.id === evaluation.id,
    );
    if (!persistedEvaluation?.comparisonGovernance) {
      throw new Error("Expected persisted evaluation governance");
    }
    persistedEvaluation.rightSnapshotSha256 = "4".repeat(64);
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(state));
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "snapshot source binding mismatch",
    );
  });

  it("fails closed on invalid persisted imported Thread provenance", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Imported state validation",
      agentId: agent.id,
      importProvenance: {
        sourceThreadId: "thread_source0000000001",
        sourceApiVersion: "2026-07-25",
        sourceContentSha256: "1".repeat(64),
        sourceEventStreamSha256: "2".repeat(64),
        sourceEventCount: 0,
        localImportedThroughSeq: 0,
        sourceModelContextEnvelopeCount: 0,
        sourceEmbeddedModelContextEnvelopeCount: 0,
        importedAt: "2026-07-25T00:00:00.000Z",
      },
    });
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    const state = JSON.parse(row.state_json) as {
      threads: Array<{
        id: string;
        importProvenance?: Record<string, unknown>;
      }>;
    };
    const persistedThread = state.threads.find(
      (candidate) => candidate.id === thread.id,
    );
    if (!persistedThread?.importProvenance) {
      throw new Error("Expected imported Thread provenance");
    }
    persistedThread.importProvenance.localImportedThroughSeq =
      thread.eventCount + 1;
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(state));
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "Persisted Thread import provenance is invalid",
    );
  });

  it("fails closed on mismatched imported Thread provenance ledger receipts", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const sourceThread = first.listThreads()[0]!;
    const bundle = await exportThreadReplayBundle(first, sourceThread.id);
    const imported = await first.importThreadReplayBundle(
      bundle,
      "Imported receipt validation",
    );
    const importEvent = imported.events.find(
      (event) => event.type === "thread.imported",
    );
    if (!importEvent) {
      throw new Error("Expected imported Thread provenance event");
    }
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT event_json FROM ledger_events WHERE thread_id = ? AND seq = ?",
      )
      .get(imported.thread.id, importEvent.seq) as { event_json: string };
    const event = JSON.parse(row.event_json) as {
      payload: Record<string, unknown>;
    };
    event.payload.sourceContentSha256 = "0".repeat(64);
    database
      .prepare(
        "UPDATE ledger_events SET event_json = ? WHERE thread_id = ? AND seq = ?",
      )
      .run(JSON.stringify(event), imported.thread.id, importEvent.seq);
    database.close();

    const reopened = new LocalStore(options);
    openStores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "Persisted Thread import provenance receipt is invalid",
    );
  });

  it("persists Agent and Casebook migrations when upgrading existing SQLite state", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const agent = first.listAgents()[0]!;
    const casebook = await first.createEvaluationCasebook({
      threadId: first.listThreads()[0]!.id,
      name: "Migrated gold set",
    });
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const databasePath = path.join(options.dataRoot, LEDGER_DATABASE_FILENAME);
    const database = new DatabaseSync(databasePath);
    const row = database
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    const legacyState = JSON.parse(row.state_json) as Record<string, unknown>;
    delete legacyState["agentRevisions"];
    delete legacyState["evaluationAdjudications"];
    delete legacyState["evaluationReviewerBallots"];
    delete legacyState["evaluationConsensusResolutions"];
    delete legacyState["evaluationCasebookQualificationExecutions"];
    delete legacyState["receiptTrustAnchors"];
    delete legacyState["evaluationQualificationBaselines"];
    const legacyCasebook = (
      legacyState["evaluationCasebooks"] as Array<Record<string, unknown>>
    )[0]!;
    delete legacyCasebook["cases"];
    for (const revision of legacyCasebook["revisions"] as Array<
      Record<string, unknown>
    >) {
      delete revision["caseIds"];
      revision["cases"] = [];
    }
    database
      .prepare("UPDATE workspace_state SET state_json = ? WHERE singleton = 1")
      .run(JSON.stringify(legacyState));
    database.close();

    const migrated = await openStore(options);
    expect(migrated.listAgentRevisions(agent.id)).toEqual([
      expect.objectContaining({
        revision: agent.revision,
        source: "migrated",
        profile: agent,
      }),
    ]);
    migrated.close();
    openStores.splice(openStores.indexOf(migrated), 1);

    const persisted = new DatabaseSync(databasePath);
    const persistedRow = persisted
      .prepare(
        "SELECT revision, state_json FROM workspace_state WHERE singleton = 1",
      )
      .get() as { revision: number; state_json: string };
    persisted.close();
    expect(persistedRow.revision).toBe(row.revision + 1);
    const persistedState = JSON.parse(persistedRow.state_json) as {
      agentRevisions?: unknown[];
      evaluationAdjudications?: unknown[];
      evaluationReviewerBallots?: unknown[];
      evaluationConsensusResolutions?: unknown[];
      evaluationCasebooks?: unknown[];
      evaluationCasebookQualificationExecutions?: unknown[];
      receiptTrustAnchors?: unknown[];
      evaluationQualificationBaselines?: unknown[];
    };
    expect(persistedState.agentRevisions).toHaveLength(1);
    expect(persistedState.evaluationAdjudications).toEqual([]);
    expect(persistedState.evaluationReviewerBallots).toEqual([]);
    expect(persistedState.evaluationConsensusResolutions).toEqual([]);
    expect(persistedState.evaluationCasebooks).toEqual([casebook]);
    expect(persistedState.evaluationCasebookQualificationExecutions).toEqual(
      [],
    );
    expect(persistedState.receiptTrustAnchors).toEqual([]);
    expect(persistedState.evaluationQualificationBaselines).toEqual([]);

    const reopened = await openStore(options);
    expect(reopened.listAgentRevisions(agent.id)).toEqual([
      expect.objectContaining({
        revision: agent.revision,
        source: "migrated",
      }),
    ]);
    expect(reopened.listEvaluationCasebooks()).toEqual([casebook]);
  });

  it("migrates legacy JSON/JSONL and repairs an event-first crash", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    const channel = await first.createInboundChannel({
      name: "Legacy channel",
      threadId: thread.id,
    });
    const delivery = await first.acceptInboundDelivery(
      channel.channel.id,
      channel.token,
      {
        idempotencyKey: "legacy-delivery-policy-0001",
        message: "Migrate the legacy delivery policy.",
      },
    );
    const memoryProposal = await first.proposeMemory(
      {
        content: "Legacy reviewed facts remain durable.",
        category: "context",
      },
      { type: "manual", threadId: thread.id },
    );
    await first.reviewMemory(memoryProposal.id, { action: "approve" });
    first.close();
    openStores.splice(openStores.indexOf(first), 1);

    const statePath = path.join(options.dataRoot, "workspace.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      agents: Array<Record<string, unknown>>;
      agentRevisions?: unknown[];
      threads: Array<{ id: string; eventCount: number }>;
      runs: Array<Record<string, unknown>>;
      memories: Array<Record<string, unknown>>;
      channels: Array<Record<string, unknown>>;
      inboundDeliveries: Array<Record<string, unknown>>;
    };
    const legacyThread = state.threads.find(
      (candidate) => candidate.id === thread.id,
    )!;
    legacyThread.eventCount = 2;
    delete state.agentRevisions;
    delete state.agents[0]?.["runLimits"];
    delete state.runs[0]?.["agentRevision"];
    delete state.runs[0]?.["limits"];
    delete state.runs[0]?.["configuration"];
    delete state.memories[0]?.["reviewIntervalDays"];
    delete state.memories[0]?.["reviewDueAt"];
    delete state.memories[0]?.["useCount"];
    delete state.channels[0]?.["retryPolicy"];
    delete state.inboundDeliveries[0]?.["retryBaseMs"];
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rm(path.join(options.dataRoot, LEDGER_DATABASE_FILENAME), {
      force: true,
    });

    const migrated = await openStore(options);
    expect(migrated.getThread(thread.id).eventCount).toBe(3);
    expect(migrated.listAgents()[0]?.runLimits).toEqual({
      maxTurns: 24,
      maxTotalTokens: 250_000,
      maxCostUsd: 10,
      timeoutMs: 900_000,
    });
    expect(migrated.listAgentRevisions(migrated.listAgents()[0]!.id)).toEqual([
      expect.objectContaining({
        revision: 1,
        source: "migrated",
        changedFields: [],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(migrated.listRuns(thread.id)[0]).toEqual(
      expect.objectContaining({
        agentRevision: 1,
        limits: expect.objectContaining({ maxTurns: 24 }),
      }),
    );
    expect(migrated.listRuns(thread.id)[0]).not.toHaveProperty("configuration");
    expect(migrated.listMemories()[0]).toEqual(
      expect.objectContaining({
        id: memoryProposal.id,
        status: "active",
        reviewIntervalDays: 90,
        reviewDueAt: expect.stringMatching(/Z$/),
        useCount: 0,
      }),
    );
    expect(
      (await migrated.listEvents(thread.id)).map((event) => event.seq),
    ).toEqual([1, 2, 3]);
    expect(migrated.getInboundChannel(channel.channel.id).retryPolicy).toEqual({
      maxAttempts: 3,
      baseDelayMs: 5_000,
    });
    expect(
      migrated
        .listInboundDeliveries(channel.channel.id)
        .find((candidate) => candidate.id === delivery.delivery.id),
    ).toEqual(expect.objectContaining({ retryBaseMs: 5_000 }));
    expect(
      await readFile(path.join(options.dataRoot, LEDGER_DATABASE_FILENAME)),
    ).not.toHaveLength(0);
  });

  it("rolls back an event when its projection update fails", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const agent = store.listAgents()[0]!;
    const thread = await store.createThread({
      title: "Atomic ledger",
      agentId: agent.id,
    });
    const run = await store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const database = new DatabaseSync(
      path.join(options.dataRoot, LEDGER_DATABASE_FILENAME),
    );
    database.exec(`
      CREATE TRIGGER abort_workspace_projection
      BEFORE UPDATE ON workspace_state
      BEGIN
        SELECT RAISE(ABORT, 'injected state failure');
      END;
    `);

    await expect(
      store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "test.atomic",
        category: "system",
        payload: { attempt: 1 },
      }),
    ).rejects.toThrow("injected state failure");

    expect(await store.listEvents(thread.id)).toEqual([]);
    expect(store.getThread(thread.id).eventCount).toBe(0);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM ledger_events WHERE thread_id = ?",
        )
        .get(thread.id),
    ).toEqual(expect.objectContaining({ count: 0 }));

    database.exec("DROP TRIGGER abort_workspace_projection");
    database.close();
    await expect(
      store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "test.atomic",
        category: "system",
        payload: { attempt: 2 },
      }),
    ).resolves.toEqual(expect.objectContaining({ seq: 1 }));
  });

  it("does not persist raw channel authorization material in SQLite or projections", async () => {
    const options = await createOptions();
    const store = await openStore(options);
    const thread = store.listThreads()[0]!;
    const created = await store.createInboundChannel({
      name: "Transactional webhook",
      threadId: thread.id,
    });
    const idempotencyKey = "transaction-secret-idempotency-key";
    await store.acceptInboundDelivery(created.channel.id, created.token, {
      idempotencyKey,
      message: "Persist this intended work evidence.",
    });

    const files = await readdir(options.dataRoot);
    const persisted = await Promise.all(
      files
        .filter(
          (file) =>
            file === "workspace.json" ||
            file.startsWith(LEDGER_DATABASE_FILENAME),
        )
        .map((file) => readFile(path.join(options.dataRoot, file))),
    );
    for (const contents of persisted) {
      expect(contents.includes(Buffer.from(created.token))).toBe(false);
      expect(contents.includes(Buffer.from(idempotencyKey))).toBe(false);
    }
  });

  it("serializes concurrent writers without losing events or thread updates", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const agent = first.listAgents()[0]!;
    const thread = await first.createThread({
      title: "Concurrent ledger",
      agentId: agent.id,
    });
    const leasedRun = await first.createLeasedRun(
      {
        threadId: thread.id,
        agentId: agent.id,
      },
      {
        ownerId: "worker_concurrent_test",
        ttlMs: 60_000,
      },
    );
    const run = leasedRun.run;
    const second = await openStore(options);

    const events = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 === 0 ? first : second).appendEvent({
          threadId: thread.id,
          runId: run.id,
          type: "test.concurrent",
          category: "system",
          payload: { index },
        }),
      ),
    );
    expect(events.map((event) => event.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).createThread({
          title: `Concurrent thread ${index}`,
          agentId: agent.id,
        }),
      ),
    );

    expect(
      (await first.listEvents(thread.id)).map((event) => event.seq),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(first.getThread(thread.id).eventCount).toBe(20);
    expect(second.listThreads()).toHaveLength(8);
  });
});
