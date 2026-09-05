import type { RunEvent, WorkspaceTrashItem } from "@napier/contracts";
import { traceSummaryBoundarySource } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { toolEventTraceSummary } from "../src/tool-event-view";
import { workspaceFileEventTraceSummary } from "../src/workspace-file-event-view";
import {
  workspaceFileRequestIsCurrent,
  workspaceTrashCardView,
} from "../src/workspace-file-view-model";

describe("Workspace file views", () => {
  it("rejects stale or cross-Thread request completions", () => {
    const token = { threadId: "thread_alpha", sequence: 3 };
    expect(workspaceFileRequestIsCurrent(token, "thread_alpha", 3)).toBe(true);
    expect(workspaceFileRequestIsCurrent(token, "thread_beta", 3)).toBe(false);
    expect(workspaceFileRequestIsCurrent(token, "thread_alpha", 4)).toBe(false);
  });

  it("projects a local recovery card with bounded hashes", () => {
    expect(workspaceTrashCardView(trashItem())).toEqual({
      id: "trash_1234567890abcdef1234",
      originalPath: "artifacts/report.txt",
      kindLabel: "File",
      scopeLabel: "1 files · 0 directories · 128 bytes",
      trashedAt: "2026-07-30T00:00:00.000Z",
      snapshotHash: "aaaaaaaaaaaa",
    });
  });

  it("summarizes mutation evidence without accepting injected paths", () => {
    const event = mutationEvent();
    const summary = workspaceFileEventTraceSummary(event);
    expect(summary).toBe(
      `workspace file mutation / trash / by agent / files 1 / directories 0 / bytes 128 / source ${"b".repeat(12)} / before ${"c".repeat(12)} / after ${"d".repeat(12)} / postcondition verified / reversible`,
    );
    expect(summary).not.toContain("TOP_SECRET");
    expect(traceSummaryBoundarySource(event)).toBe("dedicated");
  });

  it("labels operator recovery as a distinct audit event", () => {
    const event = mutationEvent();
    if (
      event.payload === null ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    ) {
      throw new Error("Mutation fixture payload must be an object");
    }
    event.type = "workspace.file.recovered";
    event.payload = {
      ...event.payload,
      operation: "restore",
      initiatedBy: "operator",
    };
    expect(workspaceFileEventTraceSummary(event)).toContain(
      "workspace file recovery / restore / by operator",
    );
  });

  it("summarizes preview and apply tool details from hash-only fields", () => {
    const event: RunEvent = {
      id: "event_1234567890abcdef1234",
      threadId: "thread_1234567890abcdef1234",
      runId: "run_1234567890abcdef1234",
      seq: 2,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      createdAt: "2026-07-30T00:00:00.000Z",
      payload: {
        toolName: "workspace_file_apply",
        status: "completed",
        details: {
          action: "apply",
          operation: "move",
          sourcePathSha256: "a".repeat(64),
          destinationPathSha256: "b".repeat(64),
          beforeSha256: "c".repeat(64),
          afterSha256: "c".repeat(64),
          fileCount: 1,
          directoryCount: 0,
          bytes: 128,
          reversible: true,
          postcondition: "verified",
          rawPath: "TOP_SECRET_PATH",
        },
      },
    };
    const summary = toolEventTraceSummary(event);
    expect(summary).toContain("file-action apply");
    expect(summary).toContain("file-operation move");
    expect(summary).toContain(`source ${"a".repeat(12)}`);
    expect(summary).toContain("postcondition verified");
    expect(summary).not.toContain("TOP_SECRET");
  });
});

function trashItem(): WorkspaceTrashItem {
  return {
    kind: "napier.workspace-trash-item",
    schemaVersion: 1,
    id: "trash_1234567890abcdef1234",
    threadId: "thread_1234567890abcdef1234",
    runId: "run_1234567890abcdef1234",
    originalPath: "artifacts/report.txt",
    originalPathSha256: "0".repeat(64),
    entryKind: "file",
    snapshotSha256: "a".repeat(64),
    fileCount: 1,
    directoryCount: 0,
    bytes: 128,
    trashedAt: "2026-07-30T00:00:00.000Z",
    contentSha256: "1".repeat(64),
  };
}

function mutationEvent(): RunEvent {
  return {
    id: "event_1234567890abcdef1234",
    threadId: "thread_1234567890abcdef1234",
    runId: "run_1234567890abcdef1234",
    seq: 1,
    type: "workspace.file.mutated",
    category: "tool",
    visibility: "user",
    createdAt: "2026-07-30T00:00:00.000Z",
    payload: {
      operation: "trash",
      initiatedBy: "agent",
      sourcePathSha256: "b".repeat(64),
      beforeSha256: "c".repeat(64),
      afterSha256: "d".repeat(64),
      fileCount: 1,
      directoryCount: 0,
      bytes: 128,
      postcondition: "verified",
      reversible: true,
      rawPath: "TOP_SECRET_PATH",
    },
  };
}
