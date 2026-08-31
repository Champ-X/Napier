import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationActivities,
  conversationActivitiesFromCandidates,
  excludeConversationActivityCandidates,
} from "../src/conversation-activity-view-model";

describe("Conversation activity", () => {
  it("keeps only user-visible high-value ledger events", () => {
    const activities = conversationActivities([
      event(1, "message.user", "message", "user", { text: "PRIVATE_PROMPT" }),
      event(2, "model.thinking.delta", "model", "hidden", {
        delta: "PRIVATE_REASONING",
      }),
      event(3, "tool.started", "tool", "user", {
        toolName: "web_search",
      }),
      event(4, "tool.completed", "tool", "user", {
        toolName: "web_search",
        status: "completed",
      }),
      event(5, "context.prepared", "system", "debug", {}),
    ]);

    expect(activities.map((activity) => activity.type)).toEqual([
      "tool.started",
      "tool.completed",
    ]);
    expect(activities.map((activity) => activity.summary)).toEqual([
      "Started · Web search",
      "Completed · Web search",
    ]);
    expect(JSON.stringify(activities)).not.toContain("PRIVATE_PROMPT");
    expect(JSON.stringify(activities)).not.toContain("PRIVATE_REASONING");
    expect(JSON.stringify(activities)).not.toMatch(/[a-f0-9]{64}/u);
  });

  it("classifies plan, approval, and blocked tool events", () => {
    const activities = conversationActivities([
      event(1, "plan.created", "plan", "user", {}),
      event(2, "operator.decision.requested", "system", "user", {}),
      event(3, "tool.blocked", "tool", "user", { toolName: "run_command" }),
    ]);

    expect(activities).toEqual([
      expect.objectContaining({ label: "Plan", tone: "info" }),
      expect.objectContaining({ label: "Approval", tone: "waiting" }),
      expect.objectContaining({ label: "Tool", tone: "blocked" }),
    ]);
  });

  it("collapses adjacent repeated activities and respects the density limit", () => {
    const events = [
      event(1, "tool.started", "tool", "user", { toolName: "read_file" }),
      event(2, "tool.started", "tool", "user", { toolName: "read_file" }),
      event(3, "tool.completed", "tool", "user", {
        toolName: "read_file",
      }),
      event(4, "plan.created", "plan", "user", {}),
    ];

    const activities = conversationActivities(events, 2);
    expect(activities).toHaveLength(2);
    expect(activities[0]).toEqual(
      expect.objectContaining({ type: "tool.completed", count: 1 }),
    );
    expect(activities[1]).toEqual(
      expect.objectContaining({ type: "plan.created", count: 1 }),
    );
    expect(conversationActivities(events)[0]).toEqual(
      expect.objectContaining({ type: "tool.started", count: 2 }),
    );
  });

  it("filters bounded candidates before applying the same collapse rules", () => {
    const candidates = [
      candidate(1, "tool.started", { callId: "call_tool" }),
      candidate(2, "tool.started", { callId: "call_tool" }),
      candidate(3, "plan.created", { planId: "plan_fixture0001" }),
      candidate(4, "run.no_progress"),
      candidate(5, "run.progress.message"),
    ];
    const filtered = excludeConversationActivityCandidates(candidates, {
      eventIds: new Set(),
      callIds: new Set(["call_tool"]),
      planIds: new Set(["plan_fixture0001"]),
      decisionIds: new Set(),
      taskIds: new Set(),
      artifactKeys: new Set(),
    });

    expect(conversationActivitiesFromCandidates(filtered)).toEqual([
      expect.objectContaining({
        seq: 4,
        type: "run.no_progress",
        summary: "Run no progress",
        count: 1,
      }),
    ]);
  });
});

function candidate(
  seq: number,
  type: string,
  bindings: Partial<{
    callId: string;
    planId: string;
  }> = {},
) {
  return {
    id: `event_${String(seq)}`,
    seq,
    type,
    label: type.startsWith("tool.")
      ? "Tool"
      : type.startsWith("plan.")
        ? "Plan"
        : "Run",
    summary:
      type === "run.no_progress"
        ? "Run no progress"
        : type.replaceAll(".", " "),
    tone: "info" as const,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    ...bindings,
  };
}

function event(
  seq: number,
  type: string,
  category: RunEvent["category"],
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category,
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
