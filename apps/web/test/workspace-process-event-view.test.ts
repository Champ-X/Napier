import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { workspaceProcessEventTraceSummary } from "../src/workspace-process-event-view";

describe("Workspace Process event view", () => {
  it("summarizes input receipts without accepting input text", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 3,
      type: "workspace.process.input",
      category: "tool",
      visibility: "user",
      createdAt: "2026-07-29T00:00:00.000Z",
      payload: {
        processId: "process_1234567890abcdef1234",
        initiatedBy: "operator",
        sequence: 2,
        inputBytes: 18,
        totalInputBytes: 32,
        inputSha256: "a".repeat(64),
        cumulativeInputSha256: "b".repeat(64),
        stdinClosed: true,
        text: "TOP_SECRET_INPUT",
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toBe(
      `process / input / id abcdef1234 / sequence 2 / by operator / bytes 18 / total-bytes 32 / input ${"a".repeat(12)} / cumulative ${"b".repeat(12)} / stdin-closed`,
    );
    expect(summary).not.toContain("TOP_SECRET");
  });

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
        workspaceDeltaStatus: "changed",
        workspaceChangedFileCount: 2,
        workspaceChangedPathSetSha256: "d".repeat(64),
        rawOutput: "TOP_SECRET_OUTPUT",
        rawArgs: ["TOP_SECRET_ARGUMENT"],
        rawPaths: ["TOP_SECRET_PATH"],
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toBe(
      `process / settled / id abcdef1234 / status succeeded / runtime node / args 2 / stdout-chars 12 / stderr-chars 0 / cursor 1 / command ${"a".repeat(12)} / stdout ${"b".repeat(12)} / stderr ${"c".repeat(12)} / workspace changed / changed-files 2 / changed-paths ${"d".repeat(12)}`,
    );
    expect(summary).not.toContain("TOP_SECRET");
  });
});
