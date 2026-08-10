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
    expect(
      workspaceProcessEventTraceSummary({
        ...event,
        payload: {
          ...(event.payload as Record<string, JsonValue>),
          runtime: "shell",
          sandbox: "host-direct",
          workspaceAccess: "read_only",
        },
      }),
    ).toContain(
      "runtime shell / sandbox host-direct / isolation none / access policy not enforced",
    );
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
        failureRecovery: "restore_scopes",
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
    expect(summary).toContain("failure-recovery restore-scopes");
    expect(summary).not.toContain("PRIVATE_WRITE_SCOPE");
  });

  it("summarizes local service isolation and identity without health paths", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 6,
      type: "workspace.process.started",
      category: "lifecycle",
      visibility: "user",
      createdAt: "2026-08-10T00:00:00.000Z",
      payload: {
        id: "process_1234567890abcdef1234",
        status: "running",
        runtime: "node",
        sandbox: "oci-container",
        workspaceAccess: "read_only",
        networkAccess: "outbound_denied_loopback_service",
        localService: {
          status: "ready",
          hostPort: 45_678,
          identitySha256: "8".repeat(64),
          healthPath: "/PRIVATE_READY_PATH",
        },
      },
    };

    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toContain(
      "sandbox oci-container / access read-only / outbound denied / loopback service / service ready / service-host-port 45678 / service 888888888888",
    );
    expect(summary).not.toContain("PRIVATE_READY_PATH");
  });

  it("summarizes rollback evidence without recovery paths or error text", () => {
    const attempt: RunEvent = {
      id: "event_1234567890abcdef1200",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 5,
      type: "workspace.process.rollback_started",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        processId: "process_1234567890abcdef1234",
        initiatedBy: "automatic_compensation",
        scopeCount: 2,
        fileCount: 3,
        directoryCount: 4,
        bytes: 25,
        previewSha256: "d".repeat(64),
        recoverySnapshotSha256: "a".repeat(64),
        expectedWorkspaceSha256: "b".repeat(64),
        rawPaths: ["PRIVATE_RECOVERY_PATH"],
      },
    };
    expect(workspaceProcessEventTraceSummary(attempt)).toBe(
      `process / rollback-started / id abcdef1234 / by automatic_compensation / scopes 2 / files 3 / directories 4 / bytes 25 / preview ${"d".repeat(12)} / recovery ${"a".repeat(12)} / expected ${"b".repeat(12)}`,
    );
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 6,
      type: "workspace.process.rolled_back",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        processId: "process_1234567890abcdef1234",
        status: "restored",
        initiatedBy: "operator",
        scopeCount: 2,
        restoredScopeCount: 2,
        fileCount: 3,
        directoryCount: 4,
        bytes: 25,
        durable: true,
        rollbackVerified: true,
        cancellationObserved: false,
        recoverySnapshotSha256: "a".repeat(64),
        expectedWorkspaceSha256: "b".repeat(64),
        observedWorkspaceSha256: "c".repeat(64),
        rawPaths: ["PRIVATE_RECOVERY_PATH"],
        rawError: "TOP_SECRET_RECOVERY_ERROR",
      },
    };
    const summary = workspaceProcessEventTraceSummary(event);
    expect(summary).toBe(
      `process / rolled-back / id abcdef1234 / status restored / by operator / scopes 2 / restored-scopes 2 / files 3 / directories 4 / bytes 25 / durable / rollback-verified / recovery ${"a".repeat(12)} / expected ${"b".repeat(12)} / observed ${"c".repeat(12)}`,
    );
    expect(summary).not.toContain("PRIVATE_RECOVERY_PATH");
    expect(summary).not.toContain("TOP_SECRET");
  });
});
