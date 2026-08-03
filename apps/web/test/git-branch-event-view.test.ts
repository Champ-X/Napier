import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const SHA256_FIELDS = {
  branchRefSha256: "0".repeat(64),
  beforeRepositoryStateSha256: "1".repeat(64),
  runtimeEvidenceSha256: "2".repeat(64),
  resultSha256: "3".repeat(64),
} as const;

describe("Git branch Trace evidence", () => {
  it("projects valid preview and apply receipts without branch names", () => {
    const previewEvent = event("git_branch_create_preview", {
      ...previewDetails(),
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      durable: false,
    });
    const preview = toolEventTraceView(previewEvent);
    expect(preview).toEqual(
      expect.objectContaining({
        gitBranchOperation: "create",
        gitBranchAction: "preview",
        gitBranchStatus: "ready",
        gitBranchTargetCommitSha1: "d".repeat(40),
      }),
    );
    expect(toolEventTraceSummary(previewEvent)).toContain(
      "git branch create preview / branch ready",
    );

    const apply = toolEventTraceView(
      event("git_branch_create_apply", {
        ...baseDetails(),
        action: "apply",
        status: "applied",
        postcondition: "verified",
        durable: true,
        refUpdateStatus: "succeeded",
        afterRepositoryStateSha256: "4".repeat(64),
        sourcePreviewResultSha256: "5".repeat(64),
      }),
    );
    expect(apply).toEqual(
      expect.objectContaining({
        gitBranchAction: "apply",
        gitBranchStatus: "applied",
        gitBranchRefUpdateStatus: "succeeded",
        gitBranchAfterRepositoryStateSha256: "4".repeat(64),
      }),
    );
    expect(JSON.stringify(apply)).not.toContain("feature/private");
  });

  it("rejects impossible outcomes, capabilities, bounds, and object IDs", () => {
    expect(
      toolEventTraceView(
        event("git_branch_create_apply", {
          ...baseDetails(),
          action: "apply",
          status: "applied",
          postcondition: "verified",
          durable: false,
          refUpdateStatus: "succeeded",
          afterRepositoryStateSha256: "4".repeat(64),
          sourcePreviewResultSha256: "5".repeat(64),
        }),
      )?.gitBranchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_create_apply", {
          ...baseDetails(),
          action: "apply",
          status: "indeterminate",
          postcondition: "verified",
          durable: false,
          refUpdateStatus: "failed",
          sourcePreviewResultSha256: "5".repeat(64),
        }),
      )?.gitBranchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_create_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          branchNameBytes: 201,
        }),
      )?.gitBranchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_create_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          targetCommitSha1: "invalid",
        }),
      )?.gitBranchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_create_preview", {
          ...baseDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
        }),
      )?.gitBranchAction,
    ).toBeUndefined();
  });
});

function previewDetails(): Record<string, JsonValue> {
  return {
    ...baseDetails(),
    previewId: "gitbranchpreview_12345678",
    expiresAt: "2026-08-03T00:05:00.000Z",
  };
}

function baseDetails(): Record<string, JsonValue> {
  return {
    kind: "napier.git-branch",
    schemaVersion: 1,
    operation: "create",
    ...SHA256_FIELDS,
    branchNameBytes: 24,
    targetCommitSha1: "d".repeat(40),
    durationMs: 75,
    cancellationObserved: false,
  };
}

function event(toolName: string, details: Record<string, JsonValue>): RunEvent {
  return {
    id: "event_git_branch",
    threadId: "thread_git_branch",
    runId: "run_git_branch",
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
