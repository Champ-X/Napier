import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const DIGESTS = {
  pathSha256: "0".repeat(64),
  pathStateSha256: "1".repeat(64),
  attributesStateSha256: "f".repeat(64),
  patchSha256: "2".repeat(64),
  beforeRepositoryStateSha256: "3".repeat(64),
  beforeNonIndexStateSha256: "4".repeat(64),
  beforeIndexSha256: "5".repeat(64),
  proposedIndexSha256: "6".repeat(64),
  sandboxSha256: "7".repeat(64),
  gitExecutableSha256: "8".repeat(64),
  gitArgumentsSha256: "9".repeat(64),
  gitEnvironmentSha256: "a".repeat(64),
  gitResourceLimitsSha256: "b".repeat(64),
  resultSha256: "c".repeat(64),
} as const;

describe("Git stage Trace evidence", () => {
  it("validates preview and apply receipts without rendering private data", () => {
    const preview = toolEventTraceView(
      event("git_stage_preview", {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        durable: false,
      }),
    );
    expect(preview).toEqual(
      expect.objectContaining({
        gitStageAction: "preview",
        gitStageStatus: "ready",
        gitStagePostcondition: "not_applied",
        gitStageFileCount: 1,
        gitStagePatchBytes: 120,
        gitStageProposedIndexSha256: "6".repeat(64),
      }),
    );
    expect(toolEventTraceSummary(
      event("git_stage_preview", {
        ...baseDetails(),
        action: "preview",
        status: "ready",
        postcondition: "not_applied",
        durable: false,
      }),
    )).toContain(
      "git stage preview / stage ready",
    );

    const apply = toolEventTraceView(
      event("git_stage_apply", {
        ...baseDetails(),
        action: "apply",
        status: "applied",
        postcondition: "verified",
        durable: true,
        afterIndexSha256: "d".repeat(64),
        sourcePreviewResultSha256: "e".repeat(64),
      }),
    );
    expect(apply).toEqual(
      expect.objectContaining({
        gitStageAction: "apply",
        gitStageStatus: "applied",
        gitStageAfterIndexSha256: "d".repeat(64),
      }),
    );
    expect(JSON.stringify(apply)).not.toContain("PRIVATE");
  });

  it("rejects impossible capability, status, digest, and bound shapes", () => {
    expect(
      toolEventTraceView(
        event("git_stage_preview", {
          ...baseDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          afterIndexSha256: "d".repeat(64),
        }),
      )?.gitStageAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_stage_apply", {
          ...baseDetails(),
          action: "apply",
          status: "applied",
          postcondition: "verified",
          durable: false,
          afterIndexSha256: "d".repeat(64),
          sourcePreviewResultSha256: "e".repeat(64),
        }),
      )?.gitStageAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_stage_apply", {
          ...baseDetails(),
          action: "apply",
          status: "indeterminate",
          postcondition: "indeterminate",
          durable: false,
          sourcePreviewResultSha256: "not-a-digest",
        }),
      )?.gitStageAction,
    ).toBeUndefined();
    expect(
      toolEventTraceView(
        event("git_stage_preview", {
          ...baseDetails(),
          action: "preview",
          status: "ready",
          postcondition: "not_applied",
          durable: false,
          patchBytes: 128 * 1024 + 1,
        }),
      )?.gitStageAction,
    ).toBeUndefined();
  });
});

function baseDetails() {
  return {
    kind: "napier.git-stage",
    schemaVersion: 1,
    ...DIGESTS,
    contextLines: 3,
    fileCount: 1,
    hunkCount: 1,
    addedLineCount: 2,
    deletedLineCount: 1,
    patchBytes: 120,
    durationMs: 45,
    cancellationObserved: false,
  };
}

function event(
  toolName: string,
  details: Record<string, JsonValue>,
): RunEvent {
  return {
    id: "event_git_stage",
    threadId: "thread_git_stage",
    runId: "run_git_stage",
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
