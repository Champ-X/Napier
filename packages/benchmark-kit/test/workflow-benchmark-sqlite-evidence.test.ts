import type { JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";
import { describe, expect, it } from "vitest";

import { validWorkflowBenchmarkSqliteFields } from "../src/workflow-benchmark-sqlite-evidence.js";

describe("Workflow benchmark SQLite evidence", () => {
  it("accepts consistent multi-series receipts and rejects invalid geometry", () => {
    const valid = chartEvent(chartDetails());

    expect(
      validWorkflowBenchmarkSqliteFields({
        sqliteActionEvents: [valid],
        databaseBeforeSha256: "2".repeat(64),
        databaseAfterSha256: "2".repeat(64),
      }),
    ).toBe(true);
    expect(
      validWorkflowBenchmarkSqliteFields({
        sqliteActionEvents: [
          {
            ...valid,
            payload: {
              ...valid.payload,
              toolProtocol: {
                ...(valid.payload["toolProtocol"] as Record<string, JsonValue>),
                toolId: "read_file",
              },
            },
          },
        ],
        databaseBeforeSha256: "2".repeat(64),
        databaseAfterSha256: "2".repeat(64),
      }),
    ).toBe(false);
    for (const details of [
      { ...chartDetails(), pointCount: 5 },
      { ...chartDetails(), rowCount: 4 },
      {
        ...chartDetails(),
        rowCount: 40,
        categoryCount: 40,
        seriesCount: 6,
        pointCount: 240,
      },
      { ...chartDetails(), truncated: true },
    ]) {
      expect(
        validWorkflowBenchmarkSqliteFields({
          sqliteActionEvents: [chartEvent(details)],
          databaseBeforeSha256: "2".repeat(64),
          databaseAfterSha256: "2".repeat(64),
        }),
      ).toBe(false);
    }
  });
});

function chartDetails(): Record<string, JsonValue> {
  return {
    kind: "napier.sqlite-chart",
    schemaVersion: 2,
    action: "chart",
    databasePathSha256: "1".repeat(64),
    databaseSha256: "2".repeat(64),
    databaseBytes: 4_096,
    sqlSha256: "3".repeat(64),
    parameterCount: 0,
    parameterSetSha256: "4".repeat(64),
    columnCount: 3,
    rowCount: 3,
    truncated: false,
    columnsSha256: "5".repeat(64),
    rowsSha256: "6".repeat(64),
    durationMs: 20,
    workerSha256: "7".repeat(64),
    runtimeSha256: "8".repeat(64),
    limitsSha256: "9".repeat(64),
    chartType: "bar",
    pointCount: 6,
    categoryCount: 3,
    seriesCount: 2,
    width: 960,
    height: 540,
    chartSpecSha256: "a".repeat(64),
    svgSha256: "b".repeat(64),
    svgBytes: 8_192,
    rendererSha256: "c".repeat(64),
    chartLimitsSha256: "d".repeat(64),
    queryResultSha256: "e".repeat(64),
    resultSha256: "f".repeat(64),
  };
}

function chartEvent(details: Record<string, JsonValue>): RunEvent {
  const payload = {
    callId: "call_chart",
    toolName: "sqlite_query",
    status: "completed",
    outputTextSha256: "0".repeat(64),
    outputTextBytes: 1_024,
    outputSha256: "1".repeat(64),
    outputBytes: 1_024,
    outputRedacted: true,
    toolProtocol: {
      kind: "napier.tool-ui-projection",
      schemaVersion: 2,
      toolId: "sqlite_query",
      semanticVersion: "1.0.0-compat.1",
      definitionSha256: "2".repeat(64),
      failureDefinitionSha256: "4".repeat(64),
      implementationSha256: "3".repeat(64),
      status: "completed",
      sideEffect: "none",
      concurrency: "safe",
      progress: {
        kind: "napier.tool-progress-semantics",
        schemaVersion: 1,
        availability: "declared",
        coverage: "opaque",
        operation: "neutral",
        scope: "neutral",
        contribution: "neutral",
      },
      compatibilityMode: "compatibility",
    },
    resultSha256: sha256(canonicalJson(details)),
    details,
  };
  return {
    id: "event_chart",
    threadId: "thread_chart",
    runId: "run_chart",
    seq: 1,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-03T00:00:00.000Z",
    payload,
  };
}
