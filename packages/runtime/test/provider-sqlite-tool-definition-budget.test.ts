import { describe, expect, it } from "vitest";

import { createSqliteQueryTool } from "../src/sqlite-query-tool.js";

const MAX_SQLITE_TOOL_DEFINITION_BYTES = 2.25 * 1024;

describe("Provider SQLite tool definition budget", () => {
  it("keeps the SQLite definition within two and a quarter KiB", () => {
    const tool = createSqliteQueryTool("/workspace");
    const bytes = Buffer.byteLength(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        constrainedSampling: tool.constrainedSampling ?? null,
      }),
      "utf8",
    );

    expect(bytes).toBeLessThanOrEqual(MAX_SQLITE_TOOL_DEFINITION_BYTES);
  });

  it("keeps hash, read-only SQL, parameter, chart, and denial guidance", () => {
    const description = createSqliteQueryTool("/workspace").description;

    expect(description).toContain("schema first");
    expect(description).toContain("databaseSha256");
    expect(description).toContain("params");
    expect(description).toContain("SELECT/WITH/VALUES");
    expect(description).toContain("xColumn");
    expect(description).toContain("yColumn XOR yColumns");
    expect(description).toContain("complete query");
    expect(description).toContain("mutation/PRAGMA/ATTACH");
    expect(description).toContain("database drift");
  });

  it("rejects action-mismatched fields before query execution", async () => {
    const tool = createSqliteQueryTool("/workspace");
    const databaseSha256 = "a".repeat(64);

    await expect(
      tool.execute("schema-extra", {
        action: "schema",
        path: "data.sqlite",
        sql: "SELECT 1",
      } as never),
    ).rejects.toThrow("unsupported fields");
    await expect(
      tool.execute("query-chart", {
        action: "query",
        path: "data.sqlite",
        databaseSha256,
        sql: "SELECT 1",
        chart: { type: "bar", xColumn: "x", yColumn: "y" },
      } as never),
    ).rejects.toThrow("cannot include chart fields");
    await expect(
      tool.execute("chart-missing", {
        action: "chart",
        path: "data.sqlite",
        databaseSha256,
        sql: "SELECT 1",
      } as never),
    ).rejects.toThrow("request is incomplete");
  });
});
