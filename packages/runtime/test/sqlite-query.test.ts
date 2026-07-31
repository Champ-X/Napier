import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSqliteDatabaseCurrent,
  inspectSqliteDatabase,
} from "../src/sqlite-database-file.js";
import { executeSqliteQuery } from "../src/sqlite-query.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("read-only SQLite query", () => {
  it("inspects schema and runs a parameterized aggregate on one bound version", async () => {
    const fixture = await createFixture();
    const schema = await executeSqliteQuery(fixture.root, {
      action: "schema",
      path: "analytics.db",
    });
    const queried = await executeSqliteQuery(fixture.root, {
      action: "query",
      path: "analytics.db",
      databaseSha256: schema.database.fileSha256,
      sql: [
        "SELECT region, SUM(amount) AS total",
        "FROM orders",
        "WHERE status = ?",
        "GROUP BY region",
        "HAVING SUM(amount) >= ?",
        "ORDER BY total DESC",
      ].join(" "),
      params: ["paid", 15],
    });

    expect(schema).toEqual(
      expect.objectContaining({
        action: "schema",
        columns: ["type", "name", "column_count", "columns"],
        truncated: false,
      }),
    );
    expect(schema.rows).toEqual(
      expect.arrayContaining([expect.arrayContaining(["table", "orders", 5])]),
    );
    expect(queried).toEqual(
      expect.objectContaining({
        action: "query",
        columns: ["region", "total"],
        rows: [
          ["west", "30"],
          ["east", "15"],
        ],
        truncated: false,
        runtimeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(queried.database.fileSha256).toBe(schema.database.fileSha256);
  });

  it("bounds rows and renders BigInt and BLOB values without raw bytes", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");
    const result = await executeSqliteQuery(fixture.root, {
      action: "query",
      path: "analytics.db",
      databaseSha256: snapshot.fileSha256,
      sql: "SELECT id, payload FROM orders ORDER BY id",
      maxRows: 2,
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[0]).toBe("1");
    expect(result.rows[0]?.[1]).toMatch(
      /^<blob bytes=3 sha256=[a-f0-9]{64}>$/u,
    );
    expect(result.truncated).toBe(true);

    const longCell = await executeSqliteQuery(fixture.root, {
      action: "query",
      path: "analytics.db",
      databaseSha256: snapshot.fileSha256,
      sql: "SELECT value FROM long_values",
    });
    expect(String(longCell.rows[0]?.[0])).toHaveLength(2_051);
    expect(String(longCell.rows[0]?.[0])).toMatch(/\.\.\.$/u);
    expect(longCell.truncated).toBe(true);
  });

  it.each([
    ["write", "UPDATE orders SET amount = 0", "not read-only"],
    ["pragma", "PRAGMA table_info(orders)", "not read-only"],
    ["attach", "ATTACH DATABASE '/tmp/other.db' AS other", "not read-only"],
    ["multiple statements", "SELECT 1; DELETE FROM orders", "one statement"],
    ["extension loading", "SELECT load_extension(?)", "not read-only"],
    ["memory amplification", "SELECT randomblob(100000000)", "not read-only"],
  ])("rejects %s SQL", async (_name, sql, error) => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");

    await expect(
      executeSqliteQuery(fixture.root, {
        action: "query",
        path: "analytics.db",
        databaseSha256: snapshot.fileSha256,
        sql,
        ...(sql.includes("?") ? { params: ["/tmp/extension"] } : {}),
      }),
    ).rejects.toThrow(error);
  });
  it("rejects stale identity, times out expensive SQL, and cancels", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");
    await expect(
      executeSqliteQuery(fixture.root, {
        action: "query",
        path: "analytics.db",
        databaseSha256: "f".repeat(64),
        sql: "SELECT 1",
      }),
    ).rejects.toThrow("does not match databaseSha256");

    const expensive =
      "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x) SELECT SUM(n) FROM x";
    await expect(
      executeSqliteQuery(fixture.root, {
        action: "query",
        path: "analytics.db",
        databaseSha256: snapshot.fileSha256,
        sql: expensive,
        timeoutMs: 100,
      }),
    ).rejects.toThrow("timed out");

    const controller = new AbortController();
    const cancelled = executeSqliteQuery(
      fixture.root,
      {
        action: "query",
        path: "analytics.db",
        databaseSha256: snapshot.fileSha256,
        sql: expensive,
        timeoutMs: 5_000,
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 25);
    await expect(cancelled).rejects.toThrow("cancelled");
  });

  it("rejects sidecars, symlinks, protected paths, and post-snapshot drift", async () => {
    const fixture = await createFixture();
    const databasePath = path.join(fixture.root, "analytics.db");
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");
    await writeFile(`${databasePath}-wal`, "active");
    await expect(
      inspectSqliteDatabase(fixture.root, "analytics.db"),
    ).rejects.toThrow("without sidecars");
    await rm(`${databasePath}-wal`);

    await symlink(databasePath, path.join(fixture.root, "linked.db"));
    await expect(
      inspectSqliteDatabase(fixture.root, "linked.db"),
    ).rejects.toThrow("must not traverse a symlink");

    await mkdir(path.join(fixture.root, ".git"));
    await writeFile(path.join(fixture.root, ".git", "private.db"), "private");
    await expect(
      inspectSqliteDatabase(fixture.root, ".git/private.db"),
    ).rejects.toThrow("protected");

    const database = new DatabaseSync(databasePath);
    database.exec("UPDATE orders SET amount = amount + 1");
    database.close();
    await expect(assertSqliteDatabaseCurrent(snapshot)).rejects.toThrow(
      "changed during query",
    );
  });

  it("discards a result when the source database changes during execution", async () => {
    const fixture = await createFixture();
    const databasePath = path.join(fixture.root, "analytics.db");
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");
    const query = executeSqliteQuery(fixture.root, {
      action: "query",
      path: "analytics.db",
      databaseSha256: snapshot.fileSha256,
      sql: "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x WHERE n < 1000000) SELECT SUM(n) FROM x",
      timeoutMs: 5_000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const database = new DatabaseSync(databasePath);
    database.exec("UPDATE orders SET amount = amount + 1");
    database.close();

    await expect(query).rejects.toThrow("changed during query");
  });

  it("enforces the global active process bound", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture.root, "analytics.db");
    const expensive =
      "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x) SELECT SUM(n) FROM x";
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        executeSqliteQuery(fixture.root, {
          action: "query",
          path: "analytics.db",
          databaseSha256: snapshot.fileSha256,
          sql: expensive,
          timeoutMs: 500,
        }),
      ),
    );

    expect(
      results.filter(
        (result) =>
          result.status === "rejected" &&
          String(result.reason).includes("process limit reached"),
      ),
    ).toHaveLength(1);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  });
});

async function createFixture(): Promise<{
  root: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sqlite-query-"));
  roots.push(root);
  const database = new DatabaseSync(path.join(root, "analytics.db"), {
    enableDoubleQuotedStringLiterals: false,
  });
  database.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      region TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payload BLOB
    ) STRICT;
    CREATE TABLE long_values (value TEXT NOT NULL) STRICT;
  `);
  const insert = database.prepare(
    "INSERT INTO orders (id, region, status, amount, payload) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(1, "east", "paid", 10, Buffer.from([1, 2, 3]));
  insert.run(2, "east", "paid", 5, Buffer.from([4, 5]));
  insert.run(3, "west", "paid", 30, Buffer.from([6]));
  insert.run(4, "west", "pending", 100, null);
  database
    .prepare("INSERT INTO long_values (value) VALUES (?)")
    .run("x".repeat(3_000));
  database.close();
  return { root };
}
