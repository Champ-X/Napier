import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  branchEventTraceSummary,
  branchEventTraceView,
} from "../src/branch-event-view";

describe("Branch event trace view", () => {
  it("projects branch lineage without prose fields", () => {
    const event = branchEvent("branch.created", {
      sourceThreadId: "thread_1234567890",
      sourceSeq: 42,
      name: "TOP_SECRET_BRANCH_NAME",
      description: "TOP_SECRET_BRANCH_DESCRIPTION",
      text: "TOP_SECRET_BRANCH_TEXT",
    });

    expect(branchEventTraceView(event)).toEqual({
      action: "created",
      sourceThreadId: "thread_1234567890",
      sourceSeq: 42,
    });
    expect(branchEventTraceSummary(event)).toBe(
      "branch / created / source-thread 1234567890 / source-seq 42",
    );
    expect(branchEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed branch payloads and future prose fields", () => {
    expect(branchEventTraceSummary(branchEvent("branch.created", []))).toBe(
      "branch receipt",
    );
    expect(
      branchEventTraceSummary(
        branchEvent("branch.future", {
          objective: "TOP_SECRET_BRANCH_OBJECTIVE",
          fromSeq: 7,
        }),
      ),
    ).toBe("branch / future / from-seq 7");
  });
});

function branchEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_branch",
    runId: "run_branch",
    seq: 50,
    type,
    category: "lifecycle",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
