import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_SQLITE_CHART_POINTS,
  SQLITE_CHART_RENDERER_SHA256,
  renderSqliteChart,
} from "../src/sqlite-chart-renderer.js";
import { executeSqliteChart } from "../src/sqlite-chart.js";
import { inspectSqliteDatabase } from "../src/sqlite-database-file.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("verified SQLite chart rendering", () => {
  it("renders deterministic fixed-grammar bar and line SVG with escaped labels", () => {
    const spec = {
      type: "bar" as const,
      xColumn: "region",
      yColumn: "total",
      title: 'Revenue <script> & "review"',
      xLabel: "Region",
      yLabel: "Paid total",
      width: 800,
      height: 480,
    };
    const first = renderSqliteChart(
      spec,
      ["region", "total"],
      [
        ["west<&", "30"],
        ["east", -15],
        ["zero", 0],
      ],
    );
    const second = renderSqliteChart(
      spec,
      ["region", "total"],
      [
        ["west<&", "30"],
        ["east", -15],
        ["zero", 0],
      ],
    );
    const line = renderSqliteChart(
      { ...spec, type: "line" },
      ["region", "total"],
      [
        ["west", "30"],
        ["east", "15"],
      ],
    );

    expect(first).toEqual(second);
    expect(first.svgSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(SQLITE_CHART_RENDERER_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.points).toEqual([
      { label: "west<&", value: 30 },
      { label: "east", value: -15 },
      { label: "zero", value: 0 },
    ]);
    expect(first.svg).toContain(
      "Revenue &lt;script&gt; &amp; &quot;review&quot;",
    );
    expect(first.svg).toContain("west&lt;&amp;");
    expect(first.svg).toContain("<rect");
    expect(first.svg).not.toContain("<script>");
    expect(first.svg).not.toMatch(/\b(?:href|onload|style)=/u);
    expect(first.svg).not.toContain("<foreignObject");
    expect(line.svg).toContain("<polyline");
    expect(line.svg).toContain("<circle");
  });

  it("rejects ambiguous columns, incomplete geometry, and unsafe values", () => {
    expect(() =>
      renderSqliteChart(
        { type: "bar", xColumn: "missing", yColumn: "total" },
        ["region", "total"],
        [["west", 30]],
      ),
    ).toThrow("missing or ambiguous");
    expect(() =>
      renderSqliteChart(
        { type: "bar", xColumn: "region", yColumn: "total" },
        ["region", "total", "total"],
        [["west", 30, 30]],
      ),
    ).toThrow("missing or ambiguous");
    expect(() =>
      renderSqliteChart(
        { type: "line", xColumn: "region", yColumn: "total" },
        ["region", "total"],
        [
          ["west", 30],
          ["west", 15],
        ],
      ),
    ).toThrow("X values must be unique");
    expect(() =>
      renderSqliteChart(
        { type: "bar", xColumn: "region", yColumn: "total" },
        ["region", "total"],
        [["west", "not-a-number"]],
      ),
    ).toThrow("Y values must be finite numbers");
    expect(() =>
      renderSqliteChart(
        { type: "bar", xColumn: "region", yColumn: "total" },
        ["region", "total"],
        [["x".repeat(81), 30]],
      ),
    ).toThrow("invalid or oversized");
    expect(() =>
      renderSqliteChart(
        { type: "bar", xColumn: "region", yColumn: "total" },
        ["region", "total"],
        Array.from({ length: MAX_SQLITE_CHART_POINTS + 1 }, (_, index) => [
          `point-${index}`,
          index,
        ]),
      ),
    ).toThrow("1-50 complete rows");
    expect(() =>
      renderSqliteChart(
        {
          type: "bar",
          xColumn: "region",
          yColumn: "total",
          width: 200,
        },
        ["region", "total"],
        [["west", 30]],
      ),
    ).toThrow("dimensions are invalid");
    expect(() =>
      renderSqliteChart(
        {
          type: "bar",
          xColumn: "region",
          yColumn: "total",
          title: "spoof\u202etitle",
        },
        ["region", "total"],
        [["west", 30]],
      ),
    ).toThrow("text is invalid");
    expect(() =>
      renderSqliteChart(
        { type: "line", xColumn: "region", yColumn: "total" },
        ["region", "total"],
        [
          ["minimum", -1e308],
          ["maximum", 1e308],
        ],
      ),
    ).toThrow("range exceeds finite geometry");
  });

  it("executes a real aggregate and binds the complete SVG to its query result", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture, "analytics.db");
    const result = await executeSqliteChart(fixture, {
      action: "chart",
      path: "analytics.db",
      databaseSha256: snapshot.fileSha256,
      sql: "SELECT region, SUM(amount) AS total FROM orders WHERE status = ? GROUP BY region ORDER BY total DESC",
      params: ["paid"],
      chart: {
        type: "bar",
        xColumn: "region",
        yColumn: "total",
        title: "Paid revenue by region",
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "chart",
        columns: ["region", "total"],
        rows: [
          ["west", "30"],
          ["east", "15"],
        ],
        truncated: false,
        pointCount: 2,
        svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        chartSpecSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        queryResultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(result.svg).toContain("Paid revenue by region");
    expect(result.database.fileSha256).toBe(snapshot.fileSha256);
  });

  it("rejects stale, truncated, timed-out, cancelled, and drifting chart queries", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture, "analytics.db");
    const request = {
      action: "chart" as const,
      path: "analytics.db",
      databaseSha256: snapshot.fileSha256,
      sql: "SELECT region, SUM(amount) AS total FROM orders GROUP BY region ORDER BY total DESC",
      chart: { type: "bar" as const, xColumn: "region", yColumn: "total" },
    };
    await expect(
      executeSqliteChart(fixture, {
        ...request,
        params: "not-an-array",
      } as unknown as Parameters<typeof executeSqliteChart>[1]),
    ).rejects.toThrow("request is invalid");
    await expect(
      executeSqliteChart(fixture, {
        ...request,
        databaseSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("does not match databaseSha256");
    await expect(
      executeSqliteChart(fixture, { ...request, maxRows: 1 }),
    ).rejects.toThrow("complete query result");

    const expensive =
      "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x) SELECT 'all' AS label, SUM(n) AS value FROM x";
    await expect(
      executeSqliteChart(fixture, {
        ...request,
        sql: expensive,
        timeoutMs: 100,
        chart: { type: "line", xColumn: "label", yColumn: "value" },
      }),
    ).rejects.toThrow("timed out");

    const controller = new AbortController();
    const cancelled = executeSqliteChart(
      fixture,
      {
        ...request,
        sql: expensive,
        timeoutMs: 5_000,
        chart: { type: "line", xColumn: "label", yColumn: "value" },
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 25);
    await expect(cancelled).rejects.toThrow("cancelled");

    const drifting = executeSqliteChart(fixture, {
      ...request,
      sql: "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x WHERE n < 1000000) SELECT 'all' AS label, SUM(n) AS value FROM x",
      timeoutMs: 5_000,
      chart: { type: "line", xColumn: "label", yColumn: "value" },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const database = new DatabaseSync(path.join(fixture, "analytics.db"));
    database.exec("UPDATE orders SET amount = amount + 1");
    database.close();
    await expect(drifting).rejects.toThrow("SQLite database changed");
  });

  it("shares the existing global SQLite worker admission bound", async () => {
    const fixture = await createFixture();
    const snapshot = await inspectSqliteDatabase(fixture, "analytics.db");
    const expensive =
      "WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM x) SELECT 'all' AS label, SUM(n) AS value FROM x";
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        executeSqliteChart(fixture, {
          action: "chart",
          path: "analytics.db",
          databaseSha256: snapshot.fileSha256,
          sql: expensive,
          timeoutMs: 500,
          chart: { type: "line", xColumn: "label", yColumn: "value" },
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

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sqlite-chart-"));
  roots.push(root);
  const database = new DatabaseSync(path.join(root, "analytics.db"));
  database.exec(`
    CREATE TABLE orders (
      region TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL
    ) STRICT;
    INSERT INTO orders VALUES
      ('east', 'paid', 10),
      ('east', 'paid', 5),
      ('west', 'paid', 30),
      ('west', 'pending', 100);
  `);
  database.close();
  return root;
}
