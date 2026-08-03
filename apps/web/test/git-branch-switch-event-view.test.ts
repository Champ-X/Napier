import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const SHA256_FIELDS = {
  targetRefSha256: "1".repeat(64),
  beforeRepositoryStateSha256: "2".repeat(64),
  beforeHeadReflogStateSha256: "3".repeat(64),
  runtimeEvidenceSha256: "4".repeat(64),
  resultSha256: "5".repeat(64),
} as const;

describe("Git branch switch Trace evidence", () => {
  it("projects valid preview and apply receipts without branch names", () => {
    const previewEvent = event("git_branch_switch_preview", {
      ...previewDetails(),
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      durable: false,
    });
    const preview = toolEventTraceView(previewEvent);
    expect(preview).toEqual(
      expect.objectContaining({
        gitBranchSwitchAction: "preview",
        gitBranchSwitchStatus: "ready",
        gitBranchSwitchCommitSha1: "d".repeat(40),
      }),
    );
    expect(toolEventTraceSummary(previewEvent)).toContain(
      "git branch switch preview / switch ready",
    );

    const apply = toolEventTraceView(
      event("git_branch_switch_apply", {
        ...baseDetails(),
        action: "apply",
        status: "applied",
        postcondition: "verified",
        durable: true,
        switchStatus: "succeeded",
        afterRepositoryStateSha256: "6".repeat(64),
        afterHeadReflogStateSha256: "7".repeat(64),
        sourcePreviewResultSha256: "8".repeat(64),
      }),
    );
    expect(apply).toEqual(
      expect.objectContaining({
        gitBranchSwitchAction: "apply",
        gitBranchSwitchStatus: "applied",
        gitBranchSwitchProcessStatus: "succeeded",
        gitBranchSwitchAfterHeadReflogStateSha256: "7".repeat(64),
      }),
    );
    expect(JSON.stringify(apply)).not.toContain("feature/private");

    const divergent = toolEventTraceView(
      event("git_branch_switch_preview", {
        ...previewDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        durable: false,
        sourceCommitSha1: "c".repeat(40),
        checkoutRequired: true,
        fileCount: 1,
        recoveryAction: "rolled_back",
        addedLineCount: 1,
        patchSha256: "9".repeat(64),
        patchBytes: 24,
        worktreeTransitionSha256: "a".repeat(64),
      }),
    );
    expect(divergent).toEqual(
      expect.objectContaining({
        gitBranchSwitchCheckoutRequired: true,
        gitBranchSwitchFileCount: 1,
        gitBranchSwitchRecoveryAction: "rolled_back",
      }),
    );
  });

  it("rejects impossible outcomes, capabilities, bounds, and object IDs", () => {
    expect(
      toolEventTraceView(
        event("git_branch_switch_apply", {
          ...baseDetails(),
          action: "apply",
          status: "applied",
          postcondition: "verified",
          durable: false,
          switchStatus: "succeeded",
          afterRepositoryStateSha256: "6".repeat(64),
          afterHeadReflogStateSha256: "7".repeat(64),
          sourcePreviewResultSha256: "8".repeat(64),
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          checkoutRequired: true,
          fileCount: 0,
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_apply", {
          ...baseDetails(),
          action: "apply",
          status: "indeterminate",
          postcondition: "verified",
          durable: false,
          switchStatus: "failed",
          sourcePreviewResultSha256: "8".repeat(64),
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          targetBranchNameBytes: 201,
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          durationMs: 300_001,
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_preview", {
          ...previewDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          commitSha1: "invalid",
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_branch_switch_preview", {
          ...baseDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
        }),
      )?.gitBranchSwitchAction,
    ).toBeUndefined();
  });
});

function previewDetails(): Record<string, JsonValue> {
  return {
    ...baseDetails(),
    previewId: "gitswitchpreview_12345678",
    expiresAt: "2026-08-03T00:05:00.000Z",
  };
}

function baseDetails(): Record<string, JsonValue> {
  return {
    kind: "napier.git-branch-switch",
    schemaVersion: 1,
    ...SHA256_FIELDS,
    targetBranchNameBytes: 24,
    sourceCommitSha1: "d".repeat(40),
    commitSha1: "d".repeat(40),
    checkoutRequired: false,
    fileCount: 0,
    recoveryAction: "none",
    addedLineCount: 0,
    deletedLineCount: 0,
    patchSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    patchBytes: 0,
    worktreeTransitionSha256:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    proposedIndexSha256: "b".repeat(64),
    durationMs: 75,
    cancellationObserved: false,
  };
}

function event(toolName: string, details: Record<string, JsonValue>): RunEvent {
  return {
    id: "event_git_branch_switch",
    threadId: "thread_git_branch_switch",
    runId: "run_git_branch_switch",
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
