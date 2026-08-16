import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("normalized Run lease persistence", () => {
  it("renews a heartbeat without rewriting workspace state or compatibility files", async () => {
    const fixture = await createFixture();
    const store = await openStore(fixture);
    const leased = await createLeasedRun(store);
    const beforeRow = workspaceRow(fixture.dataRoot);
    const beforeProjection = await readFile(
      path.join(fixture.dataRoot, "workspace.json"),
    );
    const beforeMetrics = store.getPersistenceMetrics();

    const renewed = await store.renewRunLease(
      leased.run.id,
      leased.token,
      30_000,
    );

    expect(renewed.lease?.revision).toBe(2);
    expect(workspaceRow(fixture.dataRoot)).toEqual(beforeRow);
    expect(
      await readFile(path.join(fixture.dataRoot, "workspace.json")),
    ).toEqual(beforeProjection);
    expect(runLeaseRow(fixture.dataRoot, leased.run.id)).toEqual(
      expect.objectContaining({
        threadId: leased.run.threadId,
        revision: 2,
        heartbeatAt: renewed.lease?.heartbeatAt,
        expiresAt: renewed.lease?.expiresAt,
      }),
    );
    const afterMetrics = store.getPersistenceMetrics();
    expect(afterMetrics).toEqual(
      expect.objectContaining({
        commitCount: beforeMetrics.commitCount + 1,
        stateBytesWritten: beforeMetrics.stateBytesWritten,
        eventBytesWritten: beforeMetrics.eventBytesWritten,
        projectionBytesWritten: beforeMetrics.projectionBytesWritten,
        last: expect.objectContaining({
          status: "committed",
          revision: beforeRow.revision,
          stateBytes: 0,
          eventCount: 0,
          eventBytes: 0,
          touchedThreadCount: 0,
          stateProjectionBytes: 0,
          eventProjectionBytes: 0,
        }),
      }),
    );
    expect(
      readDatabaseBytes(fixture.dataRoot).includes(Buffer.from(leased.token)),
    ).toBe(false);
  });

  it("serializes two Store heartbeats and survives a later full snapshot", async () => {
    const fixture = await createFixture();
    const first = await openStore(fixture);
    const leased = await createLeasedRun(first);
    const second = await openStore(fixture);
    const before = workspaceRow(fixture.dataRoot);

    const renewed = await Promise.all([
      first.renewRunLease(leased.run.id, leased.token, 30_000),
      second.renewRunLease(leased.run.id, leased.token, 30_000),
    ]);

    expect(
      renewed
        .map((run) => run.lease?.revision)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([2, 3]);
    expect(workspaceRow(fixture.dataRoot)).toEqual(before);
    expect(first.listRuns(leased.run.threadId).at(-1)?.lease?.revision).toBe(3);
    expect(second.listRuns(leased.run.threadId).at(-1)?.lease?.revision).toBe(
      3,
    );

    await second.createThread({
      title: "Snapshot after heartbeat",
      agentId: second.listAgents()[0]!.id,
    });
    expect(runLeaseRow(fixture.dataRoot, leased.run.id)?.revision).toBe(3);

    await first.finishRun(leased.run.id, "completed", {
      leaseToken: leased.token,
    });
    expect(runLeaseRow(fixture.dataRoot, leased.run.id)).toBeUndefined();
    first.close();
    stores.splice(stores.indexOf(first), 1);
    second.close();
    stores.splice(stores.indexOf(second), 1);

    const reopened = await openStore(fixture);
    expect(reopened.listRuns(leased.run.threadId).at(-1)).toEqual(
      expect.objectContaining({
        id: leased.run.id,
        status: "completed",
      }),
    );
    expect(reopened.listRuns(leased.run.threadId).at(-1)).not.toHaveProperty(
      "lease",
    );
  });

  it("migrates schema-3 active leases from the state snapshot", async () => {
    const fixture = await createFixture();
    const first = await openStore(fixture);
    const leased = await createLeasedRun(first);
    first.close();
    stores.splice(stores.indexOf(first), 1);
    const database = databaseFor(fixture.dataRoot);
    database.exec(`
      DROP TABLE run_leases;
      DELETE FROM ledger_schema_migrations WHERE version = 4;
      PRAGMA user_version = 3;
    `);
    database.close();

    const migrated = await openStore(fixture);

    expect(migrated.getLedgerSchemaReport().migrations.at(-1)).toEqual(
      expect.objectContaining({
        version: 4,
        name: "normalized_run_leases",
      }),
    );
    expect(runLeaseRow(fixture.dataRoot, leased.run.id)).toEqual(
      expect.objectContaining({
        threadId: leased.run.threadId,
        revision: 1,
      }),
    );
    expect(migrated.listRuns(leased.run.threadId).at(-1)?.lease?.revision).toBe(
      1,
    );
  });

  it("fails closed when a normalized lease is rebound to another Thread", async () => {
    const fixture = await createFixture();
    const first = await openStore(fixture);
    const leased = await createLeasedRun(first);
    first.close();
    stores.splice(stores.indexOf(first), 1);
    const database = databaseFor(fixture.dataRoot);
    database
      .prepare("UPDATE run_leases SET thread_id = ? WHERE run_id = ?")
      .run("thread_tampered0001", leased.run.id);
    database.close();

    const reopened = new LocalStore(fixture);
    stores.push(reopened);
    await expect(reopened.initialize()).rejects.toThrow(
      "SQLite Run lease binding is invalid",
    );
  });
});

async function createFixture(): Promise<{
  dataRoot: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-run-lease-state-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  return { dataRoot: path.join(root, "data"), workspaceRoot };
}

async function openStore(fixture: {
  dataRoot: string;
  workspaceRoot: string;
}): Promise<LocalStore> {
  const store = new LocalStore(fixture);
  stores.push(store);
  await store.initialize();
  return store;
}

async function createLeasedRun(store: LocalStore) {
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Normalized Run lease",
    agentId: agent.id,
  });
  return store.createLeasedRun(
    { threadId: thread.id, agentId: agent.id },
    { ownerId: "worker.normalized", ttlMs: 30_000 },
  );
}

function databaseFor(dataRoot: string): DatabaseSync {
  return new DatabaseSync(path.join(dataRoot, LEDGER_DATABASE_FILENAME));
}

function workspaceRow(dataRoot: string): {
  revision: number;
  snapshotRevision: number;
  stateJson: string;
} {
  const database = databaseFor(dataRoot);
  try {
    const row = database
      .prepare(
        `SELECT revision, snapshot_revision, state_json
         FROM workspace_state WHERE singleton = 1`,
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

function runLeaseRow(
  dataRoot: string,
  runId: string,
):
  | {
      threadId: string;
      heartbeatAt: string;
      expiresAt: string;
      revision: number;
    }
  | undefined {
  const database = databaseFor(dataRoot);
  try {
    const row = database
      .prepare(
        `SELECT thread_id, heartbeat_at, expires_at, revision
         FROM run_leases WHERE run_id = ?`,
      )
      .get(runId) as
      | {
          thread_id: string;
          heartbeat_at: string;
          expires_at: string;
          revision: number;
        }
      | undefined;
    return row
      ? {
          threadId: row.thread_id,
          heartbeatAt: row.heartbeat_at,
          expiresAt: row.expires_at,
          revision: row.revision,
        }
      : undefined;
  } finally {
    database.close();
  }
}

function readDatabaseBytes(dataRoot: string): Buffer {
  return readFileSync(path.join(dataRoot, LEDGER_DATABASE_FILENAME));
}
