import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { traceEventSummaryView } from "../src/trace-event-summary-view";
import { workflowEventTraceSummary } from "../src/workflow-event-view";

describe("Workflow event Trace projection", () => {
  it("summarizes start and completion evidence without input or output bodies", () => {
    const started = workflowEvent("workflow.started", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      blueprintSha256: "2".repeat(64),
      workflowVersion: 3,
      nodeCount: 2,
      input: { secret: "PRIVATE_WORKFLOW_INPUT" },
      inputSha256: "3".repeat(64),
      inputSchemaSha256: "4".repeat(64),
      outputSchemaSha256: "5".repeat(64),
      outputNodeId: "report",
    });
    const completed = workflowEvent("workflow.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      manifestSha256: "1".repeat(64),
      blueprintSha256: "2".repeat(64),
      status: "completed",
      nodeResultCount: 2,
      completedNodeCount: 2,
      outputSha256: "6".repeat(64),
      resultSha256: "7".repeat(64),
      output: "PRIVATE_WORKFLOW_OUTPUT",
    });

    expect(workflowEventTraceSummary(started)).toBe(
      `workflow started / version 3 / nodes 2 / input ${"3".repeat(12)} / input-schema ${"4".repeat(12)} / output-schema ${"5".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(completed)).toBe(
      `workflow completed / status completed / completed 2/2 / result ${"7".repeat(12)} / output ${"6".repeat(12)} / manifest ${"1".repeat(12)}`,
    );
    expect(traceEventSummaryView(started)).toEqual({
      text: workflowEventTraceSummary(started),
      source: "bounded",
    });
    expect(
      `${workflowEventTraceSummary(started)} ${workflowEventTraceSummary(completed)}`,
    ).not.toContain("PRIVATE_WORKFLOW");
  });

  it("summarizes node completion, recovery, and fixed failure diagnostics", () => {
    const completed = workflowEvent("workflow.node.completed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inspect",
      attempt: 2,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      outputSha256: "5".repeat(64),
      recovered: true,
    });
    const failed = workflowEvent("workflow.node.failed", {
      schemaVersion: 1,
      planId: "plan_abcdefghijklmnopqrst",
      nodeId: "inspect",
      attempt: 1,
      manifestSha256: "1".repeat(64),
      inputSha256: "2".repeat(64),
      inputSchemaSha256: "3".repeat(64),
      outputSchemaSha256: "4".repeat(64),
      errorCode: "output_invalid",
      diagnosticSha256: "6".repeat(64),
      error: "PRIVATE_MODEL_ERROR",
    });

    expect(workflowEventTraceSummary(completed)).toContain(
      `node inspect / attempt 2 / input ${"2".repeat(12)} / output-schema ${"4".repeat(12)} / output ${"5".repeat(12)} / recovered`,
    );
    expect(workflowEventTraceSummary(failed)).toContain(
      `error output_invalid / diagnostic ${"6".repeat(12)}`,
    );
    expect(workflowEventTraceSummary(failed)).not.toContain(
      "PRIVATE_MODEL_ERROR",
    );
  });

  it("rejects malformed Workflow evidence", () => {
    expect(
      workflowEventTraceSummary(
        workflowEvent("workflow.node.failed", {
          schemaVersion: 1,
          planId: "plan_abcdefghijklmnopqrst",
          nodeId: "inspect",
          attempt: 1,
          manifestSha256: "1".repeat(64),
          inputSha256: "2".repeat(64),
          outputSchemaSha256: "3".repeat(64),
          errorCode: "PRIVATE ERROR",
          diagnosticSha256: "4".repeat(64),
        }),
      ),
    ).toBeUndefined();
  });
});

function workflowEvent(
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    id: "event_abcdefghijklmnopqrst",
    threadId: "thread_abcdefghijklmnopqrst",
    runId: "run_abcdefghijklmnopqrst",
    seq: 1,
    type,
    category: "plan",
    visibility: "user",
    createdAt: "2026-07-30T00:00:00.000Z",
    payload: payload as RunEvent["payload"],
  };
}
