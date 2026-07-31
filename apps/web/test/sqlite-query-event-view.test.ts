import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  sqliteQueryEventEvidence,
  sqliteQuerySummaryParts,
} from "../src/sqlite-query-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("SQLite query Trace projection", () => {
  it("projects bounded database and result evidence", () => {
    const view = sqliteQueryEventEvidence(details("query"));

    expect(view).toEqual(
      expect.objectContaining({
        sqliteQueryAction: "query",
        sqliteDatabaseBytes: 4_096,
        sqliteParameterCount: 2,
        sqliteColumnCount: 3,
        sqliteRowCount: 10,
        sqliteResultTruncated: true,
        sqliteDurationMs: 42,
      }),
    );
    expect(sqliteQuerySummaryParts(view!)).toContain("sqlite query");
    expect(sqliteQuerySummaryParts(view!)).toContain("rows 10");
    expect(sqliteQuerySummaryParts(view!)).toContain("result-truncated");
    expect(sqliteQuerySummaryParts(view!)).toContain(
      `runtime ${"8".repeat(12)}`,
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SQLITE");
  });

  it("integrates SQLite evidence into generic tool summaries", () => {
    const event: RunEvent = {
      id: "event_sqlite",
      threadId: "thread_sqlite",
      runId: "run_sqlite",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "sqlite_query",
        status: "completed",
        effect: "read",
        output: "PRIVATE_SQLITE_ROWS",
        details: details("query"),
      },
      createdAt: "2026-07-31T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "sqlite_query",
        status: "completed",
        effect: "read",
        sqliteQueryAction: "query",
        sqliteRowCount: 10,
      }),
    );
    const summary = toolEventTraceSummary(event);
    expect(summary).toContain("tool / sqlite_query / completed / effect read");
    expect(summary).toContain("sqlite query");
    expect(summary).not.toContain("PRIVATE_SQLITE");
  });

  it("projects complete chart evidence without SVG or semantic labels", () => {
    const view = sqliteQueryEventEvidence(chartDetails());

    expect(view).toEqual(
      expect.objectContaining({
        sqliteQueryAction: "chart",
        sqliteChartType: "bar",
        sqliteChartPointCount: 10,
        sqliteChartWidth: 960,
        sqliteChartHeight: 540,
        sqliteChartSvgBytes: 12_345,
      }),
    );
    const summary = sqliteQuerySummaryParts(view!);
    expect(summary).toContain("sqlite chart");
    expect(summary).toContain("chart bar");
    expect(summary).toContain("chart-points 10");
    expect(summary).toContain("chart-size 960x540");
    expect(summary).toContain(`svg ${"b".repeat(12)}`);
    expect(JSON.stringify(view)).not.toContain("PRIVATE_CHART");
  });

  it("fails closed on partial or impossible evidence", () => {
    expect(
      sqliteQueryEventEvidence({
        ...details("schema"),
        parameterCount: 1,
      }),
    ).toBeUndefined();
    expect(
      sqliteQueryEventEvidence({
        ...details("query"),
        databaseBytes: 128 * 1024 * 1024,
      }),
    ).toBeUndefined();
    expect(
      sqliteQueryEventEvidence({
        ...details("query"),
        rowsSha256: undefined,
      }),
    ).toBeUndefined();
    expect(
      sqliteQueryEventEvidence({
        ...chartDetails(),
        pointCount: 9,
      }),
    ).toBeUndefined();
    expect(
      sqliteQueryEventEvidence({
        ...chartDetails(),
        truncated: true,
      }),
    ).toBeUndefined();
    expect(
      sqliteQueryEventEvidence({
        ...chartDetails(),
        svgSha256: undefined,
      }),
    ).toBeUndefined();
  });
});

function details(action: "schema" | "query") {
  return {
    kind: "napier.sqlite-query",
    schemaVersion: 1,
    action,
    databasePathSha256: "1".repeat(64),
    databaseSha256: "2".repeat(64),
    databaseBytes: 4_096,
    sqlSha256:
      action === "schema"
        ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        : "3".repeat(64),
    parameterCount: action === "schema" ? 0 : 2,
    parameterSetSha256: "4".repeat(64),
    columnCount: 3,
    rowCount: 10,
    truncated: true,
    columnsSha256: "5".repeat(64),
    rowsSha256: "6".repeat(64),
    durationMs: 42,
    workerSha256: "7".repeat(64),
    runtimeSha256: "8".repeat(64),
    limitsSha256: "9".repeat(64),
    resultSha256: "a".repeat(64),
    path: "PRIVATE_SQLITE_PATH",
    sql: "PRIVATE_SQLITE_SQL",
    rows: ["PRIVATE_SQLITE_ROWS"],
  };
}

function chartDetails() {
  return {
    ...details("query"),
    kind: "napier.sqlite-chart",
    action: "chart",
    truncated: false,
    chartType: "bar",
    pointCount: 10,
    width: 960,
    height: 540,
    svgBytes: 12_345,
    chartSpecSha256: "a".repeat(64),
    svgSha256: "b".repeat(64),
    rendererSha256: "c".repeat(64),
    chartLimitsSha256: "d".repeat(64),
    queryResultSha256: "e".repeat(64),
    title: "PRIVATE_CHART_TITLE",
    svg: "<svg>PRIVATE_CHART</svg>",
  };
}
