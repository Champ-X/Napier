import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { executeSqliteChart } from "../src/sqlite-chart.js";
import { executeSqliteQuery } from "../src/sqlite-query.js";

const describeLive =
  process.env["NAPIER_LIVE_SQLITE_SMOKE"] === "1" ? describe : describe.skip;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live SQLite analysis smoke", () => {
  it("queries a real static database snapshot in a bounded child process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-live-sqlite-"));
    roots.push(root);
    const database = new DatabaseSync(path.join(root, "analytics.sqlite"));
    database.exec(`
      CREATE TABLE sales (
        region TEXT NOT NULL,
        amount INTEGER NOT NULL
      ) STRICT;
      INSERT INTO sales VALUES ('east', 10), ('east', 5), ('west', 30);
    `);
    database.close();

    const schema = await executeSqliteQuery(root, {
      action: "schema",
      path: "analytics.sqlite",
    });
    const result = await executeSqliteQuery(root, {
      action: "query",
      path: "analytics.sqlite",
      databaseSha256: schema.database.fileSha256,
      sql: "SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC",
    });
    const chart = await executeSqliteChart(root, {
      action: "chart",
      path: "analytics.sqlite",
      databaseSha256: schema.database.fileSha256,
      sql: "SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC",
      chart: {
        type: "bar",
        xColumn: "region",
        yColumn: "total",
        title: "Sales by region",
      },
    });

    expect(schema.rows).toEqual(
      expect.arrayContaining([expect.arrayContaining(["table", "sales", 2])]),
    );
    expect(result.rows).toEqual([
      ["west", "30"],
      ["east", "15"],
    ]);
    expect(result.durationMs).toBeLessThan(5_000);
    expect(chart.pointCount).toBe(2);
    expect(chart.svg).toContain("Sales by region");
    expect(chart.svgSha256).toMatch(/^[a-f0-9]{64}$/u);
  }, 15_000);
});
