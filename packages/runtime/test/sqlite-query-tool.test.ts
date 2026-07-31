import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { builtInToolEffect } from "../src/agent-tool-effects.js";
import { assessToolCall } from "../src/policy.js";
import {
  createSqliteQueryTool,
  sqliteQueryToolCallArgumentsLedgerProjection,
  sqliteQueryToolOutputLedgerProjection,
} from "../src/sqlite-query-tool.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("sqlite_query Agent tool", () => {
  it("runs schema then a hash-bound query with privacy-bounded details", async () => {
    const root = await fixture();
    const tool = createSqliteQueryTool(root);
    const schema = await tool.execute("schema-call", {
      action: "schema",
      path: "private-analytics.db",
    });
    const databaseSha256 = schema.details.databaseSha256;
    const queried = await tool.execute("query-call", {
      action: "query",
      path: "private-analytics.db",
      databaseSha256,
      sql: "SELECT category, SUM(value) AS total FROM metrics WHERE category <> ? GROUP BY category",
      params: ["PRIVATE_PARAMETER"],
    });

    expect(schema.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("metrics"),
      }),
    );
    expect(queried.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining('"total": "30"'),
      }),
    );
    expect(queried.details).toEqual(
      expect.objectContaining({
        kind: "napier.sqlite-query",
        action: "query",
        databaseSha256,
        parameterCount: 1,
        columnCount: 2,
        rowCount: 2,
        runtimeSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(queried.details)).not.toContain("PRIVATE");
  });

  it("returns deterministic chart SVG live and keeps chart bodies out of Ledger projections", async () => {
    const root = await fixture();
    const tool = createSqliteQueryTool(root);
    const schema = await tool.execute("schema-chart-call", {
      action: "schema",
      path: "private-analytics.db",
    });
    const args = {
      action: "chart" as const,
      path: "private-analytics.db",
      databaseSha256: schema.details.databaseSha256,
      sql: "SELECT category AS PRIVATE_LABEL, SUM(value) AS PRIVATE_TOTAL FROM metrics GROUP BY category ORDER BY PRIVATE_TOTAL DESC",
      chart: {
        type: "bar" as const,
        xColumn: "PRIVATE_LABEL",
        yColumn: "PRIVATE_TOTAL",
        title: "PRIVATE CHART TITLE <review>",
      },
    };
    const charted = await tool.execute("chart-call", args);
    const live = charted.content[0]?.text ?? "";

    expect(live).toContain("<svg");
    expect(live).toContain("PRIVATE CHART TITLE &lt;review&gt;");
    expect(live).not.toContain("<review>");
    expect(charted.details).toEqual(
      expect.objectContaining({
        kind: "napier.sqlite-chart",
        schemaVersion: 1,
        action: "chart",
        chartType: "bar",
        pointCount: 2,
        rowCount: 2,
        truncated: false,
        svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        rendererSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );

    const call = sqliteQueryToolCallArgumentsLedgerProjection(args);
    const output = sqliteQueryToolOutputLedgerProjection(live, {
      details: charted.details,
    });
    const durable = JSON.stringify({ call, output, details: charted.details });
    for (const secret of [
      "private-analytics",
      "PRIVATE_LABEL",
      "PRIVATE_TOTAL",
      "PRIVATE CHART TITLE",
      "<svg",
      "alpha",
      "beta",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(call).toEqual(
      expect.objectContaining({
        action: "chart",
        chartType: "bar",
        chartRequestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        redacted: true,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it("requires workspace confinement and remains a read effect", () => {
    const workspace = path.resolve("/workspace");
    expect(
      assessToolCall(
        "observe",
        "sqlite_query",
        { action: "schema", path: "data/analytics.db" },
        workspace,
      ),
    ).toEqual(expect.objectContaining({ allowed: true, risk: "low" }));
    expect(
      assessToolCall(
        "workspace",
        "sqlite_query",
        { action: "schema", path: "../analytics.db" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "path escapes the configured workspace",
      }),
    );
    expect(
      assessToolCall(
        "workspace",
        "sqlite_query",
        { action: "schema", path: ".git/private.db" },
        workspace,
      ),
    ).toEqual(
      expect.objectContaining({
        allowed: false,
        reason: "SQLite queries cannot read protected path segment: .git",
      }),
    );
    expect(builtInToolEffect("sqlite_query")).toBe("read");
  });

  it("redacts path, SQL, parameters, and live rows from Ledger projections", () => {
    const args = {
      action: "query",
      path: "PRIVATE_DATABASE_PATH.db",
      databaseSha256: "a".repeat(64),
      sql: "SELECT PRIVATE_COLUMN FROM PRIVATE_TABLE WHERE secret = ?",
      params: ["PRIVATE_PARAMETER"],
      maxRows: 10,
    };
    const call = sqliteQueryToolCallArgumentsLedgerProjection(args);
    const output = sqliteQueryToolOutputLedgerProjection("PRIVATE_RESULT_ROW", {
      details: {
        kind: "napier.sqlite-query",
        schemaVersion: 1,
        action: "query",
        resultSha256: "b".repeat(64),
      },
    });
    const durable = JSON.stringify({ call, output });

    for (const secret of [
      "PRIVATE_DATABASE_PATH",
      "PRIVATE_COLUMN",
      "PRIVATE_TABLE",
      "PRIVATE_PARAMETER",
      "PRIVATE_RESULT_ROW",
    ]) {
      expect(durable).not.toContain(secret);
    }
    expect(call).toEqual(
      expect.objectContaining({
        action: "query",
        databaseSha256: "a".repeat(64),
        databasePathSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sqlSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        parameterCount: 1,
        redacted: true,
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        outputBytes: 18,
      }),
    );
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-sqlite-tool-"));
  roots.push(root);
  const database = new DatabaseSync(path.join(root, "private-analytics.db"));
  database.exec(
    "CREATE TABLE metrics (category TEXT NOT NULL, value INTEGER NOT NULL) STRICT",
  );
  const insert = database.prepare(
    "INSERT INTO metrics (category, value) VALUES (?, ?)",
  );
  insert.run("alpha", 10);
  insert.run("alpha", 20);
  insert.run("beta", 30);
  database.close();
  return root;
}
