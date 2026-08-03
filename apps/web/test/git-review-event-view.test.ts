import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const DIGESTS = {
  sourceBranchRefSha256: "0".repeat(64),
  targetBranchRefSha256: "1".repeat(64),
  patchSha256: "2".repeat(64),
  reviewPlanSha256: "3".repeat(64),
  beforeRepositoryStateSha256: "4".repeat(64),
  runtimeEvidenceSha256: "5".repeat(64),
  resultSha256: "6".repeat(64),
} as const;

describe("Git review Trace evidence", () => {
  it("validates preview and apply receipts without rendering private data", () => {
    const previewEvent = event("git_review_preview", {
      ...baseDetails(),
      action: "preview",
      status: "ready",
      postcondition: "not_applied",
      previewId: "gitreviewpreview_12345678",
      expiresAt: "2026-08-03T00:05:00.000Z",
      durable: false,
    });
    expect(toolEventTraceView(previewEvent)).toEqual(
      expect.objectContaining({
        gitReviewAction: "preview",
        gitReviewStatus: "ready",
        gitReviewCommitCount: 2,
        gitReviewFileCount: 1,
        gitReviewSourceCommitSha1: "a".repeat(40),
        gitReviewTargetCommitSha1: "b".repeat(40),
      }),
    );
    expect(toolEventTraceSummary(previewEvent)).toContain(
      "git review preview / review ready",
    );

    const apply = toolEventTraceView(
      event("git_review_apply", {
        ...baseDetails(),
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        afterRepositoryStateSha256: "7".repeat(64),
        sourcePreviewResultSha256: "8".repeat(64),
        durable: true,
      }),
    );
    expect(apply).toEqual(
      expect.objectContaining({
        gitReviewAction: "apply",
        gitReviewStatus: "applied",
        gitReviewRefUpdateStatus: "succeeded",
        gitReviewDurable: true,
      }),
    );
    expect(JSON.stringify(apply)).not.toContain("PRIVATE");
  });

  it("rejects impossible capability, ref, commit, patch, and durability shapes", () => {
    for (const details of [
      {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        durable: false,
        refUpdateStatus: "succeeded",
      },
      {
        ...baseDetails(),
        action: "apply",
        status: "applied",
        postcondition: "verified",
        refUpdateStatus: "succeeded",
        afterRepositoryStateSha256: "7".repeat(64),
        sourcePreviewResultSha256: "8".repeat(64),
        durable: false,
      },
      {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId: "gitreviewpreview_12345678",
        expiresAt: "2026-08-03T00:05:00.000Z",
        sourceCommitSha1: "b".repeat(40),
        durable: false,
      },
      {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId: "gitreviewpreview_12345678",
        expiresAt: "2026-08-03T00:05:00.000Z",
        fileCount: 0,
        patchBytes: 120,
        durable: false,
      },
      {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId: "gitreviewpreview_12345678",
        expiresAt: "invalid",
        durable: false,
      },
    ]) {
      expect(
        toolEventTraceView(event("git_review_preview", details))
          ?.gitReviewAction,
      ).toBeUndefined();
    }
  });

  it("accepts a fast-forward range with no tree delta", () => {
    const view = toolEventTraceView(
      event("git_review_preview", {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        previewId: "gitreviewpreview_12345678",
        expiresAt: "2026-08-03T00:05:00.000Z",
        fileCount: 0,
        hunkCount: 0,
        addedLineCount: 0,
        deletedLineCount: 0,
        patchBytes: 64,
        durable: false,
      }),
    );
    expect(view).toEqual(
      expect.objectContaining({
        gitReviewAction: "preview",
        gitReviewFileCount: 0,
        gitReviewPatchBytes: 64,
      }),
    );
  });
});

function baseDetails() {
  return {
    kind: "napier.git-review",
    schemaVersion: 1,
    ...DIGESTS,
    sourceBranchNameBytes: 20,
    targetBranchNameBytes: 10,
    sourceCommitSha1: "a".repeat(40),
    targetCommitSha1: "b".repeat(40),
    commitCount: 2,
    fileCount: 1,
    hunkCount: 1,
    addedLineCount: 2,
    deletedLineCount: 1,
    patchBytes: 120,
    durationMs: 45,
    cancellationObserved: false,
  };
}

function event(toolName: string, details: Record<string, JsonValue>): RunEvent {
  return {
    id: "event_git_review",
    threadId: "thread_git_review",
    runId: "run_git_review",
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
