import { describe, expect, it } from "vitest";

import {
  groupConversationFeed,
  type ConversationFeedItem,
} from "../src/conversation-feed-grouping";

describe("Conversation feed grouping", () => {
  it("groups a mixed execution burst into one continuous stage", () => {
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
    ).toEqual(["6 steps"]);
  });

  it("keeps the execution wrapper stable as the first burst grows", () => {
    const firstProjection = groupConversationFeed([tool(1, "read_file")]);
    const secondProjection = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "list_files"),
    ]);

    expect(firstProjection[0]).toEqual(
      expect.objectContaining({
        kind: "activity-group",
        id: "execution:1",
        summary: "1 step",
      }),
    );
    expect(secondProjection[0]).toEqual(
      expect.objectContaining({
        kind: "activity-group",
        id: "execution:1",
        summary: "2 steps",
      }),
    );
  });

  it("groups thinking, network, and browser evidence into the same execution burst", () => {
    const grouped = groupConversationFeed([
      thinking(0),
      network(1, "search"),
      network(2, "fetch"),
      browser(3, "snapshot"),
      browser(4, "screenshot"),
    ]);

    expect(
      grouped.map((item) =>
        item.kind === "activity-group" ? item.summary : item.kind,
      ),
    ).toEqual(["5 steps"]);
  });

  it("does not merge execution bursts across a message boundary", () => {
    const grouped = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "apply_patch"),
      message(3),
      tool(4, "read_file"),
      tool(5, "apply_patch"),
    ]);
    expect(grouped.map((item) => item.kind)).toEqual([
      "activity-group",
      "message",
      "activity-group",
    ]);
  });

  it("keeps explicit progress narration between execution bursts", () => {
    const grouped = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "list_files"),
      progress(3),
      tool(4, "apply_patch"),
      tool(5, "verify_workspace"),
    ]);

    expect(grouped.map((item) => item.kind)).toEqual([
      "activity-group",
      "progress",
      "activity-group",
    ]);
  });

  it("summarizes failures inside their task stage without repeating diagnostics", () => {
    const grouped = groupConversationFeed([
      tool(1, "read_file"),
      tool(2, "read_file"),
      tool(3, "read_file"),
      tool(4, "read_file", "tool", "failed"),
      tool(5, "read_file"),
      tool(6, "read_file"),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual(
      expect.objectContaining({
        kind: "activity-group",
        label: "Execution",
        summary: "6 steps · 1 need attention",
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
    ).toEqual(["4 steps"]);
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

function thinking(seq: number): ConversationFeedItem {
  return {
    kind: "thinking",
    seq,
    activity: {
      id: `thinking_${String(seq)}`,
      runId: "run_1",
      seq,
      lastSeq: seq,
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
      startedAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
      turnSeq: seq,
      summaryKind: "inspect",
    },
  };
}

function message(seq: number): ConversationFeedItem {
  return {
    kind: "message",
    seq,
    message: {
      id: `message_${String(seq)}`,
      seq,
      role: "assistant",
      text: "Checkpoint",
      model: "napier/demo",
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
    },
  };
}

function progress(seq: number): ConversationFeedItem {
  return {
    kind: "progress",
    seq,
    note: {
      id: `progress_${String(seq)}`,
      runId: "run_1",
      seq,
      text: "I have the template structure; next I will build the page.",
      createdAt: new Date(Date.UTC(2026, 7, 8, 0, 0, seq)).toISOString(),
    },
  };
}
