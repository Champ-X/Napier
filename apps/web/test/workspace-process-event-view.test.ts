import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { workspaceProcessEventTraceSummary } from "../src/workspace-process-event-view";

describe("Workspace Process event view", () => {
  it("summarizes bounded lifecycle evidence without output or arguments", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 4,
      type: "workspace.process.settled",
      category: "lifecycle",
      visibility: "user",
      createdAt: "2026-07-29T00:00:00.000Z",
      payload: {
        id: "process_1234567890abcdef1234",
        status: "succeeded",
        runtime: "node",
        argumentCount: 2,
        stdoutChars: 12,
        stderrChars: 0,
        nextCursor: 1,
        commandSha256: "a".repeat(64),
        stdoutSha256: "b".repeat(64),
        stderrSha256: "c".repeat(64),
        rawOutput: "TOP_SECRET_OUTPUT",
        rawArgs: ["TOP_SECRET_ARGUMENT"],
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toBe(
      `process / settled / id abcdef1234 / status succeeded / runtime node / args 2 / stdout-chars 12 / stderr-chars 0 / cursor 1 / command ${"a".repeat(12)} / stdout ${"b".repeat(12)} / stderr ${"c".repeat(12)}`,
    );
    expect(summary).not.toContain("TOP_SECRET");
  });
});
