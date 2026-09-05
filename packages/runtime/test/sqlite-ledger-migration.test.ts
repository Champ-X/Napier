import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEDGER_DATABASE_FILENAME,
  LEDGER_SCHEMA_VERSION,
  LocalStore,
} from "../src/index.js";

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

describe("SQLite ledger schema migration", () => {
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

  it("migrates an existing ledger through durable concurrency leases", async () => {
    const options = await createOptions();
    const first = await openStore(options);
    const thread = first.listThreads()[0]!;
    expect(first.getLedgerSchemaReport()).toEqual(
      expect.objectContaining({
        schemaVersion: LEDGER_SCHEMA_VERSION,
        quickCheck: "ok",
        migrations: migrationHistory("initial_schema"),
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
        migrations: migrationHistory("initial_schema_backfill"),
      }),
    );
  });
});

function migrationHistory(initialName: string) {
  return [
    expect.objectContaining({ version: 1, name: initialName }),
    expect.objectContaining({ version: 2, name: "schema_migration_history" }),
    expect.objectContaining({ version: 3, name: "event_only_state_snapshots" }),
    expect.objectContaining({ version: 4, name: "normalized_run_leases" }),
    expect.objectContaining({ version: 5, name: "indexed_event_queries" }),
    expect.objectContaining({ version: 6, name: "atomic_event_idempotency" }),
    expect.objectContaining({
      version: 7,
      name: "durable_tool_concurrency_leases",
    }),
  ];
}

async function createOptions() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-ledger-migration-"));
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
