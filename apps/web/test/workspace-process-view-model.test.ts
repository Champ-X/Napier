import type {
  WorkspaceProcessOutput,
  WorkspaceProcessSession,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  appendWorkspaceProcessOutput,
  workspaceProcessCardView,
  workspaceProcessRequestIsCurrent,
  workspaceProcessSelectionRequestIsCurrent,
} from "../src/workspace-process-view-model";

describe("Workspace Process view model", () => {
  it("projects a bounded process card without command or output text", () => {
    const session = fixture();
    expect(workspaceProcessCardView(session)).toEqual({
      id: session.id,
      status: "succeeded",
      statusLabel: "Succeeded",
      running: false,
      startedAt: session.startedAt,
      settledAt: session.settledAt,
      durationLabel: "1,250 ms",
      runtimeLabel: "node · macos-sandbox-exec",
      scopeLabel: "Workspace read-only · Network denied",
      limitLabel: "30s · 32,000 chars/stream",
      outputLabel: "12 stdout · 3 stderr · cursor 2",
      outputAvailable: true,
      stdinState: "unavailable",
      stdinCanClose: false,
      stdinLabel: "Input metadata unavailable for this session version",
      workspaceDeltaState: "unchanged",
      workspaceDeltaLabel: "No workspace drift observed",
      workspaceDeltaAvailable: true,
      workspaceDeltaHashes: "222222222222 / 333333333333 / 444444444444",
      commandHash: "aaaaaaaaaaaa",
      resultHashes: "bbbbbbbbbbbb / cccccccccccc",
    });
    expect(JSON.stringify(workspaceProcessCardView(session))).not.toContain(
      "SECRET",
    );
  });

  it("projects interactive stdin state and rejects stale request tokens", () => {
    expect(
      workspaceProcessCardView({
        ...fixture(),
        schemaVersion: 3,
        stdinMode: "interactive",
        stdinOpen: true,
        stdinWriteCount: 2,
        stdinBytes: 128,
        stdinSha256: "9".repeat(64),
      }),
    ).toEqual(
      expect.objectContaining({
        stdinState: "open",
        stdinCanClose: true,
        stdinLabel: "2 writes · 128 bytes · open",
        stdinHash: "999999999999",
      }),
    );
    const token = { threadId: "thread_alpha", sequence: 2 };
    expect(workspaceProcessRequestIsCurrent(token, "thread_alpha", 2)).toBe(
      true,
    );
    expect(workspaceProcessRequestIsCurrent(token, "thread_beta", 2)).toBe(
      false,
    );
    expect(workspaceProcessRequestIsCurrent(token, "thread_alpha", 3)).toBe(
      false,
    );
    const selectionToken = {
      threadId: "thread_alpha",
      processId: "process_alpha",
      sequence: 4,
    };
    expect(
      workspaceProcessSelectionRequestIsCurrent(
        selectionToken,
        "thread_alpha",
        "process_alpha",
        4,
      ),
    ).toBe(true);
    expect(
      workspaceProcessSelectionRequestIsCurrent(
        selectionToken,
        "thread_alpha",
        "process_beta",
        4,
      ),
    ).toBe(false);
  });

  it("projects PTY dimensions, merged output, and truthful close controls", () => {
    expect(
      workspaceProcessCardView({
        ...fixture(),
        schemaVersion: 4,
        ioMode: "pty",
        stdinMode: "interactive",
        stdinOpen: true,
        stdinWriteCount: 1,
        stdinBytes: 6,
        stdinSha256: "9".repeat(64),
        terminalType: "xterm-256color",
        terminalColumns: 111,
        terminalRows: 43,
        terminalResizeCount: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        runtimeLabel: "node · macos-sandbox-exec · PTY 111×43 · 1 resize",
        outputLabel: "12 merged terminal chars · cursor 2",
        stdinState: "open",
        stdinCanClose: false,
      }),
    );
  });

  it("projects scoped writes and distinguishes verified from unknown scope", () => {
    const scoped = {
      ...fixture(),
      schemaVersion: 5 as const,
      workspaceAccess: "scoped_write" as const,
      writePreviewSha256: "5".repeat(64),
      writeScopeCount: 2,
      writeScopeSetSha256: "6".repeat(64),
      workspaceWriteScopeStatus: "within_scope" as const,
      workspaceDeltaStatus: "changed" as const,
      workspaceChangedFileCount: 2,
      ioMode: "pipe" as const,
      stdinMode: "closed" as const,
      stdinOpen: false,
      stdinWriteCount: 0,
      stdinBytes: 0,
      stdinSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    };
    expect(workspaceProcessCardView(scoped)).toEqual(
      expect.objectContaining({
        scopeLabel:
          "Workspace scoped write · 2 scopes · 666666666666 · Network denied",
        workspaceDeltaLabel: "2 paths changed within approved scope",
      }),
    );
    expect(
      workspaceProcessCardView({
        ...scoped,
        workspaceWriteScopeStatus: "outside_scope",
      }).workspaceDeltaLabel,
    ).toBe("2 observed path changes include unverified scope");
  });

  it("distinguishes observed drift, indeterminate comparison, and unavailable legacy evidence", () => {
    expect(
      workspaceProcessCardView({
        ...fixture(),
        workspaceDeltaStatus: "changed",
        workspaceChangedFileCount: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        workspaceDeltaState: "changed",
        workspaceDeltaLabel: "2 files drifted during window",
      }),
    );
    expect(
      workspaceProcessCardView({
        ...fixture(),
        workspaceDeltaStatus: "indeterminate",
        workspaceDeltaAvailable: true,
      }),
    ).toEqual(
      expect.objectContaining({
        workspaceDeltaState: "indeterminate",
        workspaceDeltaLabel: "Workspace comparison indeterminate",
      }),
    );
    const {
      workspaceDeltaStatus: _workspaceDeltaStatus,
      ...withoutDeltaStatus
    } = fixture();
    expect(
      workspaceProcessCardView({
        ...withoutDeltaStatus,
        workspaceDeltaAvailable: false,
      }),
    ).toEqual(
      expect.objectContaining({
        workspaceDeltaState: "unavailable",
        workspaceDeltaLabel: "Workspace comparison unavailable",
      }),
    );
  });

  it("deduplicates ordered cursor chunks and retains the bounded tail", () => {
    const incoming: WorkspaceProcessOutput = {
      kind: "napier.workspace-process-output",
      schemaVersion: 1,
      processId: "process_1234567890abcdef1234",
      status: "running",
      afterCursor: 1,
      nextCursor: 3,
      hasMore: false,
      outputAvailable: true,
      chunks: [
        { cursor: 2, stream: "stderr", text: "two" },
        { cursor: 3, stream: "stdout", text: "three" },
      ],
    };
    expect(
      appendWorkspaceProcessOutput(
        [
          { cursor: 1, stream: "stdout", text: "one" },
          { cursor: 2, stream: "stderr", text: "old" },
        ],
        incoming,
      ),
    ).toEqual([
      { cursor: 1, stream: "stdout", text: "one" },
      { cursor: 2, stream: "stderr", text: "two" },
      { cursor: 3, stream: "stdout", text: "three" },
    ]);
  });
});

function fixture(): WorkspaceProcessSession {
  return {
    kind: "napier.workspace-process-session",
    schemaVersion: 2,
    id: "process_1234567890abcdef1234",
    threadId: "thread_1234567890abcdef1234",
    runId: "run_1234567890abcdef1234",
    runtime: "node",
    status: "succeeded",
    sandbox: "macos-sandbox-exec",
    workspaceAccess: "read_only",
    networkAccess: "denied",
    argumentCount: 2,
    commandSha256: "a".repeat(64),
    executableSha256: "d".repeat(64),
    environmentSha256: "e".repeat(64),
    resourceLimitsSha256: "f".repeat(64),
    cwdPathSha256: "0".repeat(64),
    timeoutMs: 30_000,
    outputLimitChars: 32_000,
    workspaceBeforeSha256: "2".repeat(64),
    workspaceBeforeTruncated: false,
    workspaceAfterSha256: "3".repeat(64),
    workspaceAfterTruncated: false,
    workspaceDeltaStatus: "unchanged",
    workspaceChangedFileCount: 0,
    workspaceChangedPathSetSha256: "4".repeat(64),
    workspaceDeltaAvailable: true,
    startedAt: "2026-07-29T00:00:00.000Z",
    settledAt: "2026-07-29T00:00:01.250Z",
    durationMs: 1_250,
    exitCode: 0,
    signal: null,
    stdoutChars: 12,
    stderrChars: 3,
    stdoutSha256: "b".repeat(64),
    stderrSha256: "c".repeat(64),
    stdoutTruncated: false,
    stderrTruncated: false,
    nextCursor: 2,
    outputAvailable: true,
    contentSha256: "1".repeat(64),
  };
}
