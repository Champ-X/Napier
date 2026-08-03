import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const SHA256_FIELDS = {
  messageSha256: "0".repeat(64),
  branchRefSha256: "1".repeat(64),
  identitySha256: "2".repeat(64),
  stagedPatchSha256: "3".repeat(64),
  beforeRepositoryStateSha256: "4".repeat(64),
  runtimeEvidenceSha256: "5".repeat(64),
  resultSha256: "c".repeat(64),
} as const;

describe("Git commit Trace evidence", () => {
  it("projects valid preview and apply receipts without message or patch text", () => {
    const previewEvent = event("git_commit_preview", {
      ...previewDetails(),
      mergeParentCommitSha1: "a".repeat(40),
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      durable: false,
    });
    const preview = toolEventTraceView(previewEvent);
    expect(preview).toEqual(
      expect.objectContaining({
        gitCommitAction: "preview",
        gitCommitStatus: "ready",
        gitCommitFileCount: 2,
        gitCommitProposedSha1: "e".repeat(40),
        gitCommitMergeParentSha1: "a".repeat(40),
      }),
    );
    expect(toolEventTraceSummary(previewEvent)).toContain(
      "git commit preview / commit ready",
    );
    const zeroDeltaMerge = toolEventTraceView(
      event("git_commit_preview", {
        ...previewDetails(),
        mergeParentCommitSha1: "a".repeat(40),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        fileCount: 0,
        hunkCount: 0,
        addedLineCount: 0,
        deletedLineCount: 0,
        durable: false,
      }),
    );
    expect(zeroDeltaMerge).toEqual(
      expect.objectContaining({
        gitCommitFileCount: 0,
        gitCommitMergeParentSha1: "a".repeat(40),
      }),
    );

    const currentApplyDetails = baseDetails();
    delete currentApplyDetails["identitySha256"];
    const apply = toolEventTraceView(
      event("git_commit_apply", {
        ...currentApplyDetails,
        action: "apply",
        status: "applied",
        postcondition: "verified",
        durable: true,
        refUpdateStatus: "succeeded",
        afterHeadStateSha256: "d".repeat(64),
        sourcePreviewResultSha256: "e".repeat(64),
      }),
    );
    expect(apply).toEqual(
      expect.objectContaining({
        gitCommitAction: "apply",
        gitCommitStatus: "applied",
        gitCommitRefUpdateStatus: "succeeded",
        gitCommitAfterHeadStateSha256: "d".repeat(64),
      }),
    );
    expect(JSON.stringify(apply)).not.toContain("PRIVATE");
  });

  it("rejects impossible apply outcomes and invalid bounds or object IDs", () => {
    expect(
      toolEventTraceView(
        event("git_commit_apply", {
          ...baseDetails(),
          action: "apply",
          status: "applied",
          postcondition: "verified",
          durable: false,
          refUpdateStatus: "succeeded",
          afterHeadStateSha256: "d".repeat(64),
          sourcePreviewResultSha256: "e".repeat(64),
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          fileCount: 0,
          hunkCount: 0,
          addedLineCount: 0,
          deletedLineCount: 0,
          durable: false,
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          mergeParentCommitSha1: "a".repeat(40),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          fileCount: 0,
          hunkCount: 1,
          addedLineCount: 0,
          deletedLineCount: 0,
          durable: false,
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          mergeParentCommitSha1: "d".repeat(40),
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          refUpdateStatus: "succeeded",
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          proposedCommitSha1: "not-an-object",
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          fileCount: 33,
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_apply", {
          ...baseDetails(),
          action: "apply",
          status: "indeterminate",
          postcondition: "verified",
          durable: false,
          refUpdateStatus: "failed",
          sourcePreviewResultSha256: "e".repeat(64),
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_commit_apply", {
          ...baseDetails(),
          action: "apply",
          status: "indeterminate",
          postcondition: "indeterminate",
          durable: true,
          refUpdateStatus: "unknown",
          sourcePreviewResultSha256: "e".repeat(64),
        }),
      )?.gitCommitAction,
    ).toBeUndefined();
  });
});

function previewDetails(): Record<string, JsonValue> {
  return {
    ...baseDetails(),
    previewId: "gitcommitpreview_12345678",
    expiresAt: "2026-08-03T00:05:00.000Z",
  };
}

function baseDetails(): Record<string, JsonValue> {
  return {
    kind: "napier.git-commit",
    schemaVersion: 1,
    ...SHA256_FIELDS,
    messageBytes: 30,
    parentCommitSha1: "d".repeat(40),
    treeSha1: "f".repeat(40),
    proposedCommitSha1: "e".repeat(40),
    commitTimestampSeconds: 1_767_225_600,
    contextLines: 3,
    fileCount: 2,
    hunkCount: 2,
    addedLineCount: 4,
    deletedLineCount: 1,
    stagedPatchBytes: 256,
    durationMs: 75,
    cancellationObserved: false,
  };
}

function event(toolName: string, details: Record<string, JsonValue>): RunEvent {
  return {
    id: "event_git_commit",
    threadId: "thread_git_commit",
    runId: "run_git_commit",
    seq: 1,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-03T00:00:00.000Z",
    payload: {
      toolName,
      status: "completed",
      details,
    },
  };
}
