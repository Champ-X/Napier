import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  gitInspectEventEvidence,
  gitInspectSummaryParts,
} from "../src/git-inspect-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Git inspection Trace projection", () => {
  it("projects bounded hash-only hunk evidence", () => {
    const view = gitInspectEventEvidence(details());

    expect(view).toEqual(
      expect.objectContaining({
        gitInspectAction: "diff",
        gitInspectScope: "working",
        gitInspectFileCount: 2,
        gitInspectHunkCount: 3,
        gitInspectAddedLineCount: 7,
        gitInspectDeletedLineCount: 4,
        gitInspectOutputBytes: 2_048,
        gitInspectIndexPresent: true,
      }),
    );
    expect(gitInspectSummaryParts(view!)).toEqual(
      expect.arrayContaining([
        "git diff working",
        "files 2",
        "hunks 3",
        `git-state ${"d".repeat(12)}`,
      ]),
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE");
  });

  it("integrates into generic summaries and rejects impossible receipts", () => {
    const event: RunEvent = {
      id: "event_git_inspect",
      threadId: "thread_git_inspect",
      runId: "run_git_inspect",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        toolName: "git_inspect",
        status: "completed",
        effect: "read",
        output: "PRIVATE_DIFF_BODY",
        details: details(),
      },
      createdAt: "2026-08-03T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        toolName: "git_inspect",
        status: "completed",
        effect: "read",
        gitInspectAction: "diff",
        gitInspectHunkCount: 3,
      }),
    );
    expect(toolEventTraceSummary(event)).toContain(
      "tool / git_inspect / completed / effect read / git diff working",
    );
    expect(toolEventTraceSummary(event)).not.toContain("PRIVATE");
    expect(
      gitInspectEventEvidence({ ...details(), outputBytes: 128 * 1024 + 1 }),
    ).toBeUndefined();
    expect(
      gitInspectEventEvidence({ ...details(), scope: undefined }),
    ).toBeUndefined();
    expect(
      gitInspectEventEvidence({
        ...details(),
        repositoryStateSha256: "invalid",
      }),
    ).toBeUndefined();
    expect(
      gitInspectEventEvidence({
        ...details(),
        conflictKind: "both_modified",
      }),
    ).toBeUndefined();
  });

  it("projects conflict classification without repository text", () => {
    const view = gitInspectEventEvidence(conflictDetails());

    expect(view).toEqual(
      expect.objectContaining({
        gitInspectAction: "conflict",
        gitInspectConflictKind: "both_modified",
        gitInspectConflictStageCount: 3,
        gitInspectBasePresent: true,
        gitInspectOursPresent: true,
        gitInspectTheirsPresent: true,
        gitInspectWorktreePresent: true,
        gitInspectConflictEvidenceSha256: "9".repeat(64),
      }),
    );
    expect(gitInspectSummaryParts(view!)).toEqual(
      expect.arrayContaining([
        "git conflict",
        "conflict both_modified",
        "stages 3",
      ]),
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE");
    expect(
      gitInspectEventEvidence({
        ...conflictDetails(),
        theirsPresent: undefined,
      }),
    ).toBeUndefined();
    expect(
      gitInspectEventEvidence({
        ...conflictDetails(),
        conflictStageCount: 2,
        basePresent: false,
      }),
    ).toBeUndefined();
    const mixed = gitInspectEventEvidence({
      ...conflictDetails(),
      fileCount: 2,
      conflictKind: "mixed",
      conflictStageCount: 5,
      oursPresent: false,
    });
    expect(mixed).toEqual(
      expect.objectContaining({
        gitInspectFileCount: 2,
        gitInspectConflictKind: "mixed",
        gitInspectConflictStageCount: 5,
        gitInspectOursPresent: false,
      }),
    );
    expect(
      gitInspectEventEvidence({
        ...conflictDetails(),
        fileCount: 2,
        conflictStageCount: 3,
      }),
    ).toBeUndefined();
    expect(
      gitInspectEventEvidence({
        ...conflictDetails(),
        conflictKind: "mixed",
        fileCount: 1,
      }),
    ).toBeUndefined();
  });
});

function conflictDetails() {
  return {
    ...details(),
    action: "conflict",
    scope: undefined,
    contextLines: undefined,
    statusEntryCount: 0,
    fileCount: 1,
    hunkCount: 0,
    addedLineCount: 0,
    deletedLineCount: 0,
    conflictKind: "both_modified",
    conflictStageCount: 3,
    basePresent: true,
    oursPresent: true,
    theirsPresent: true,
    worktreePresent: true,
    conflictEvidenceSha256: "9".repeat(64),
  };
}

function details() {
  return {
    kind: "napier.git-inspection",
    schemaVersion: 1,
    action: "diff",
    scope: "working",
    repositoryPathSha256: "a".repeat(64),
    gitDirectorySha256: "b".repeat(64),
    pathSha256: "c".repeat(64),
    contextLines: 3,
    statusEntryCount: 0,
    fileCount: 2,
    hunkCount: 3,
    addedLineCount: 7,
    deletedLineCount: 4,
    outputSha256: "e".repeat(64),
    outputBytes: 2_048,
    repositoryStateSha256: "d".repeat(64),
    headStateSha256: "f".repeat(64),
    indexSha256: "0".repeat(64),
    indexPresent: true,
    configSha256: "1".repeat(64),
    sandboxSha256: "7".repeat(64),
    gitExecutableSha256: "2".repeat(64),
    gitArgumentsSha256: "3".repeat(64),
    gitEnvironmentSha256: "4".repeat(64),
    gitResourceLimitsSha256: "5".repeat(64),
    durationMs: 42,
    resultSha256: "6".repeat(64),
    PRIVATE_PATHS: ["PRIVATE_FILE"],
    PRIVATE_DIFF: "PRIVATE_CONTENT",
  };
}
