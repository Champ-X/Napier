import { describe, expect, it } from "vitest";

import {
  groupConversationFeed,
  type ConversationFeedItem,
} from "../src/conversation-feed-grouping";

describe("Conversation feed grouping", () => {
  it("groups repeated completed activity even when tool kinds alternate", () => {
    const feed: ConversationFeedItem[] = [
      tool(1, "read_file"),
      tool(2, "run_command", "shell"),
      tool(3, "read_file"),
      tool(4, "run_command", "shell"),
      tool(5, "read_file"),
      tool(6, "run_command", "shell"),
    ];

    const grouped = groupConversationFeed(feed);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toEqual(
      expect.objectContaining({
        kind: "activity-group",
        label: "Tool",
        summary: "Read file · 3 calls",
      }),
    );
    expect(grouped[1]).toEqual(
      expect.objectContaining({
        kind: "activity-group",
        label: "Shell",
        summary: "Run command · 3 calls",
      }),
    );
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
      "tool",
      "tool",
    ]);
    expect(grouped[1]).toEqual(
      expect.objectContaining({
        kind: "tool",
        activity: expect.objectContaining({ status: "failed" }),
      }),
    );
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
