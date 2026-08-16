import { describe, expect, it } from "vitest";

import {
  groupConversationFeed,
  type ConversationFeedItem,
} from "../src/conversation-feed-grouping";

describe("Conversation feed grouping", () => {
  it("groups mixed completed tools into task stages", () => {
    const feed: ConversationFeedItem[] = [
      tool(1, "read_file"),
      tool(2, "list_files"),
      tool(3, "apply_patch"),
      tool(4, "workspace_process"),
      tool(5, "verify_workspace"),
      tool(6, "lsp_diagnostics"),
    ];

    const grouped = groupConversationFeed(feed);
    expect(
      grouped.map((item) =>
        item.kind === "activity-group" ? item.summary : item.kind,
      ),
    ).toEqual(["Inspect · 2 steps", "Build · 2 steps", "Verify · 2 steps"]);
  });

  it("groups network and Browser evidence into Research and Inspect stages", () => {
    const grouped = groupConversationFeed([
      network(1, "search"),
      network(2, "fetch"),
      browser(3, "snapshot"),
      browser(4, "screenshot"),
    ]);

    expect(
      grouped.map((item) =>
        item.kind === "activity-group" ? item.summary : item.kind,
      ),
    ).toEqual(["Research · 2 steps", "Inspect · 2 steps"]);
  });

  it("does not merge non-contiguous stages across the burst", () => {
    const grouped = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "apply_patch"),
      tool(3, "read_file"),
      tool(4, "apply_patch"),
    ]);
    expect(grouped.map((item) => item.kind)).toEqual([
      "tool",
      "tool",
      "tool",
      "tool",
    ]);
  });

  it("keeps failures visible and uses them as aggregation boundaries", () => {
    const grouped = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "read_file"),
      tool(3, "read_file"),
      tool(4, "read_file", "tool", "failed"),
      tool(5, "read_file"),
      tool(6, "read_file"),
    ]);

    expect(grouped.map((item) => item.kind)).toEqual([
      "activity-group",
      "tool",
      "activity-group",
    ]);
    expect(grouped[1]).toEqual(
      expect.objectContaining({
        kind: "tool",
        activity: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("groups the same bounded projected activity window", () => {
    const projected = [
      tool(1, "read_file"),
      tool(2, "list_files"),
      tool(3, "apply_patch"),
      tool(4, "workspace_process"),
    ];
    expect(
      groupConversationFeed(projected).map((item) =>
        item.kind === "activity-group" ? item.summary : item.kind,
      ),
    ).toEqual(["Inspect · 2 steps", "Build · 2 steps"]);
  });
});

function tool(
  seq: number,
  toolName: string,
  kind: "shell" | "tool" = "tool",
  status: "completed" | "failed" = "completed",
): ConversationFeedItem {
  return {
    kind: "tool",
    seq,
    activity: {
      id: `event_${String(seq)}`,
      callId: `call_${String(seq)}`,
      seq,
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
      kind,
      status,
      toolName,
      evidence: {},
      receipt: `${toolName} ${status}`,
      eventIds: [`event_${String(seq)}`],
    },
  };
}

function network(seq: number, kind: "search" | "fetch"): ConversationFeedItem {
  return {
    kind: "network",
    seq,
    activity: {
      kind,
      id: `event_${String(seq)}`,
      callId: `call_${String(seq)}`,
      seq,
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
      status: "completed",
    },
  };
}

function browser(seq: number, action: string): ConversationFeedItem {
  return {
    kind: "browser",
    seq,
    activity: {
      id: `event_${String(seq)}`,
      callId: `call_${String(seq)}`,
      seq,
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
      status: "completed",
      action,
    },
  };
}
