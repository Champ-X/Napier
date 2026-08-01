import type { JsonValue, RunEvent } from "@napier/contracts";
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

  it("summarizes bounded PTY resize evidence", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 4,
      type: "workspace.process.resized",
      category: "tool",
      visibility: "user",
      createdAt: "2026-07-29T00:00:00.000Z",
      payload: {
        processId: "process_1234567890abcdef1234",
        initiatedBy: "agent",
        sequence: 2,
        columns: 111,
        rows: 43,
        rawTerminalInput: "TOP_SECRET_TERMINAL_INPUT",
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toBe(
      "process / resized / id abcdef1234 / sequence 2 / by agent / size 111x43",
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
        ioMode: "pty",
        terminalColumns: 111,
        terminalRows: 43,
        terminalResizeCount: 2,
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
      `process / settled / id abcdef1234 / status succeeded / runtime node / args 2 / stdout-chars 12 / stderr-chars 0 / cursor 1 / io pty / terminal 111x43 / resizes 2 / command ${"a".repeat(12)} / stdout ${"b".repeat(12)} / stderr ${"c".repeat(12)} / workspace changed / changed-files 2 / changed-paths ${"d".repeat(12)}`,
    );
    expect(summary).not.toContain("TOP_SECRET");
    expect(
      workspaceProcessEventTraceSummary({
        ...event,
        payload: {
          ...(event.payload as Record<string, JsonValue>),
          runtime: "python",
        },
      }),
    ).toContain("runtime python");
  });

  it("summarizes scoped write bindings without paths or preview bodies", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 5,
      type: "workspace.process.settled",
      category: "lifecycle",
      visibility: "user",
      createdAt: "2026-07-29T00:00:00.000Z",
      payload: {
        id: "process_1234567890abcdef1234",
        status: "succeeded",
        runtime: "node",
        workspaceAccess: "scoped_write",
        writeScopeCount: 2,
        writeScopeSetSha256: "d".repeat(64),
        writePreviewSha256: "e".repeat(64),
        workspaceWriteScopeStatus: "within_scope",
        workspaceDeltaStatus: "changed",
        workspaceChangedFileCount: 2,
        workspaceChangedPathSetSha256: "f".repeat(64),
        rawWritePaths: ["PRIVATE_WRITE_SCOPE"],
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toContain(
      `access scoped-write / write-scopes 2 / scope-set ${"d".repeat(12)} / write-preview ${"e".repeat(12)}`,
    );
    expect(summary).toContain("changed-path-count 2");
    expect(summary).not.toContain("changed-files");
    expect(summary).toContain("scope-status within_scope");
    expect(summary).not.toContain("PRIVATE_WRITE_SCOPE");
  });
});
