import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  subagentEventTraceSummary,
  subagentEventTraceView,
} from "../src/subagent-event-view";

describe("Subagent event trace view", () => {
  it("projects queued subagent metadata without prompt or description text", () => {
    const event = subagentEvent("subagent.queued", {
      taskId: "task_abcdef123456",
      role: "research",
      description: "TOP_SECRET_DESCRIPTION",
      prompt: "TOP_SECRET_PROMPT",
      status: "queued",
    });

    expect(subagentEventTraceView(event)).toEqual({
      action: "queued",
      taskId: "task_abcdef123456",
      role: "research",
      status: "queued",
    });
    expect(subagentEventTraceSummary(event)).toBe(
      "subagent / queued / id cdef123456 / role research / status queued",
    );
    expect(subagentEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects step receipts without raw assistant text or tool arguments", () => {
    const assistant = subagentEvent("subagent.step", {
      taskId: "task_abcdef123456",
      kind: "assistant",
      messageIndex: 3,
      text: "TOP_SECRET_ASSISTANT_TEXT",
      textSha256: "a".repeat(64),
      toolCalls: [
        { name: "read_file", arguments: { path: "TOP_SECRET_PATH" } },
      ],
    });
    const tool = subagentEvent("subagent.step", {
      taskId: "task_abcdef123456",
      kind: "tool",
      messageIndex: 4,
      toolName: "read_file",
      text: "TOP_SECRET_TOOL_RESULT",
      isError: false,
    });

    expect(subagentEventTraceSummary(assistant)).toBe(
      `subagent / step / id cdef123456 / kind assistant / message 3 / tools 1 / text ${"a".repeat(12)}`,
    );
    expect(subagentEventTraceSummary(tool)).toBe(
      "subagent / step / id cdef123456 / kind tool / message 4",
    );
    expect(subagentEventTraceSummary(assistant)).not.toContain("TOP_SECRET");
    expect(subagentEventTraceSummary(tool)).not.toContain("TOP_SECRET");
  });

  it("projects completion and outcome receipts through hashes and counts", () => {
    const event = subagentEvent("subagent.completed", {
      taskId: "task_abcdef123456",
      role: "review",
      status: "completed",
      result: "TOP_SECRET_RESULT",
      error: "TOP_SECRET_ERROR",
      stopReason: "completed",
      stepCount: 5,
      turnCount: 2,
      outcome: {
        contentSha256: "b".repeat(64),
        itemSetSha256: "c".repeat(64),
        evidenceSetSha256: "d".repeat(64),
        itemCount: 2,
        evidenceCount: 3,
        unknownCount: 1,
        summary: "TOP_SECRET_OUTCOME_SUMMARY",
      },
    });

    expect(subagentEventTraceView(event)).toEqual({
      action: "completed",
      taskId: "task_abcdef123456",
      role: "review",
      status: "completed",
      stopReason: "completed",
      turnCount: 2,
      stepCount: 5,
      itemCount: 2,
      evidenceCount: 3,
      unknownCount: 1,
      outcomeSha256: "b".repeat(64),
      itemSetSha256: "c".repeat(64),
      evidenceSetSha256: "d".repeat(64),
    });
    expect(subagentEventTraceSummary(event)).toBe(
      `subagent / completed / id cdef123456 / role review / status completed / stop completed / turns 2 / steps 5 / items 2 / evidence 3 / unknown 1 / outcome ${"b".repeat(12)} / items ${"c".repeat(12)} / evidence ${"d".repeat(12)}`,
    );
    expect(subagentEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects isolated coder worktree state without paths or preview IDs", () => {
    const event = subagentEvent("subagent.completed", {
      taskId: "task_abcdef123456",
      role: "coder",
      status: "completed",
      workspaceMode: "isolated_write",
      mergePreviewAvailable: true,
      sourceFileCount: 120,
      sourceBytes: 4096,
      writeScopeCount: 5,
      changedFileCount: 5,
      candidateAddedFileCount: 2,
      candidateModifiedFileCount: 1,
      candidateDeletedFileCount: 2,
      candidateRenamedFileCount: 1,
      sourceSnapshotSha256: "2".repeat(64),
      writeScopeSetSha256: "3".repeat(64),
      changedFileSetSha256: "4".repeat(64),
      candidateVerificationAttemptCount: 3,
      candidateVerificationFreshCount: 2,
      candidateVerificationPassedCount: 1,
      candidateVerificationFailedCount: 1,
      candidateVerificationStaleCount: 1,
      candidateVerificationSetSha256: "5".repeat(64),
      candidateCommandAttemptCount: 3,
      candidateCommandFreshCount: 2,
      candidateCommandSucceededCount: 1,
      candidateCommandFailedCount: 1,
      candidateCommandStaleCount: 1,
      candidateCommandSetSha256: "7".repeat(64),
      candidateToolchainSha256: "6".repeat(64),
      previewId: "TOP_SECRET_PREVIEW",
      changedPaths: ["TOP_SECRET_PATH"],
    });

    expect(subagentEventTraceView(event)).toEqual(
      expect.objectContaining({
        action: "completed",
        role: "coder",
        workspaceMode: "isolated_write",
        mergePreviewAvailable: true,
        sourceFileCount: 120,
        sourceBytes: 4096,
        writeScopeCount: 5,
        changedFileCount: 5,
        changedFileSetSha256: "4".repeat(64),
        candidateAddedFileCount: 2,
        candidateModifiedFileCount: 1,
        candidateDeletedFileCount: 2,
        candidateRenamedFileCount: 1,
        candidateVerificationFreshCount: 2,
        candidateVerificationPassedCount: 1,
        candidateVerificationFailedCount: 1,
        candidateVerificationStaleCount: 1,
        candidateVerificationSetSha256: "5".repeat(64),
        candidateCommandFreshCount: 2,
        candidateCommandSucceededCount: 1,
        candidateCommandFailedCount: 1,
        candidateCommandStaleCount: 1,
        candidateCommandSetSha256: "7".repeat(64),
      }),
    );
    expect(subagentEventTraceSummary(event)).toContain(
      `workspace isolated_write / merge-preview / source-files 120 / write-scopes 5 / changed-files 5 / change-set ${"4".repeat(12)} / lifecycle 2 added / 1 modified / 2 deleted / 1 renamed / candidate-verification 2 fresh / 1 passed / 1 failed / 1 stale / candidate-verification-set ${"5".repeat(12)} / candidate-commands 2 fresh / 1 succeeded / 1 failed / 1 stale / candidate-command-set ${"7".repeat(12)}`,
    );
    expect(subagentEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects repair and rejection receipts without diagnostic text", () => {
    const repair = subagentEvent("subagent.outcome.repair.requested", {
      taskId: "task_abcdef123456",
      predecessorResultSha256: "e".repeat(64),
      diagnostic: "TOP_SECRET_DIAGNOSTIC",
      requestSha256: "f".repeat(64),
      attempt: 1,
    });
    const rejected = subagentEvent("subagent.outcome.rejected", {
      taskId: "task_abcdef123456",
      status: "rejected",
      resultSha256: "0".repeat(64),
      diagnosticSha256: "1".repeat(64),
      diagnostic: "TOP_SECRET_REJECTION",
    });

    expect(subagentEventTraceSummary(repair)).toBe(
      `subagent / outcome.repair.requested / id cdef123456 / attempt 1 / request ${"f".repeat(12)}`,
    );
    expect(subagentEventTraceSummary(rejected)).toBe(
      `subagent / outcome.rejected / id cdef123456 / status rejected / result ${"0".repeat(12)} / diagnostic ${"1".repeat(12)}`,
    );
    expect(subagentEventTraceSummary(repair)).not.toContain("TOP_SECRET");
    expect(subagentEventTraceSummary(rejected)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed subagent receipts", () => {
    expect(
      subagentEventTraceSummary(
        subagentEvent("subagent.completed", {
          taskId: "bad task",
          result: "TOP_SECRET_RESULT",
        }),
      ),
    ).toBe("subagent / completed");
    expect(
      subagentEventTraceSummary(
        subagentEvent("subagent.completed", ["TOP_SECRET_RESULT"]),
      ),
    ).toBe("subagent receipt");
  });
});

function subagentEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_subagent",
    runId: "runctl_subagent",
    seq: 17,
    type,
    category: "subagent",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
