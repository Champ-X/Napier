import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  dataFrameEventEvidence,
  dataFrameSummaryParts,
} from "../src/data-frame-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("DataFrame Trace projection", () => {
  it("projects complete bounded receipts without semantic data", () => {
    const view = dataFrameEventEvidence(details());

    expect(view).toEqual(
      expect.objectContaining({
        dataFrameSourceFormat: "csv",
        dataFrameSourceRows: 40,
        dataFrameSourceColumns: 4,
        dataFrameOperationCount: 4,
        dataFrameRows: 3,
        dataFrameColumns: 2,
        dataFrameOutputBytes: 1_024,
      }),
    );
    const summary = dataFrameSummaryParts(view!);
    expect(summary).toContain("data-frame csv");
    expect(summary).toContain("source-rows 40");
    expect(summary).toContain("result-rows 3");
    expect(summary).toContain(`plan ${"c".repeat(12)}`);
    expect(JSON.stringify(view)).not.toContain("PRIVATE");
  });

  it("integrates into generic tool summaries and fails closed on invalid bounds", () => {
    const event: RunEvent = {
      id: "event_data_frame",
      threadId: "thread_data_frame",
      runId: "run_data_frame",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "data_frame",
        status: "completed",
        effect: "read",
        output: "PRIVATE_DATA_FRAME_ROWS",
        details: details(),
      },
      createdAt: "2026-08-03T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "data_frame",
        status: "completed",
        effect: "read",
        dataFrameOperationCount: 4,
        dataFrameRows: 3,
      }),
    );
    const summary = toolEventTraceSummary(event);
    expect(summary).toContain(
      "tool / data_frame / completed / effect read / data-frame csv",
    );
    expect(summary).not.toContain("PRIVATE");
    expect(
      dataFrameEventEvidence({ ...details(), operationCount: 13 }),
    ).toBeUndefined();
    expect(
      dataFrameEventEvidence({
        ...details(),
        outputBytes: 256 * 1024 + 1,
      }),
    ).toBeUndefined();
    expect(
      dataFrameEventEvidence({ ...details(), rowsSha256: undefined }),
    ).toBeUndefined();
  });
});

function details() {
  return {
    kind: "napier.data-frame",
    schemaVersion: 1,
    action: "transform",
    sourcePathSha256: "a".repeat(64),
    sourceSha256: "b".repeat(64),
    sourceBytes: 4_096,
    sourceFormat: "csv",
    sourceRowCount: 40,
    sourceColumnCount: 4,
    operationCount: 4,
    planSha256: "c".repeat(64),
    rowCount: 3,
    columnCount: 2,
    columnsSha256: "d".repeat(64),
    rowsSha256: "e".repeat(64),
    outputSha256: "f".repeat(64),
    outputBytes: 1_024,
    parserSha256: "0".repeat(64),
    engineSha256: "3".repeat(64),
    limitsSha256: "1".repeat(64),
    resultSha256: "2".repeat(64),
    columns: ["PRIVATE_COLUMN"],
    rows: [["PRIVATE_VALUE"]],
    output: "PRIVATE_OUTPUT",
  };
}
