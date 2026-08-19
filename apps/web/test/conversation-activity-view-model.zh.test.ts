import type { RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Conversation activity Chinese projection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("localizes generic event labels while preserving technical tool names", async () => {
    installChineseLocale();
    const { conversationActivities } =
      await import("../src/conversation-activity-view-model");

    const activities = conversationActivities([
      event(1, "tool.started", { toolName: "web_search" }),
      event(2, "plan.created", {}),
      event(3, "operator.decision.requested", {}),
    ]);

    expect(activities).toEqual([
      expect.objectContaining({
        label: "工具",
        summary: "已启动 · web_search",
      }),
      expect.objectContaining({ label: "计划", summary: "计划 · 已创建" }),
      expect.objectContaining({
        label: "审批",
        summary: "需要操作者输入",
      }),
    ]);
  });

  it("localizes bounded server candidates by their stable event type", async () => {
    installChineseLocale();
    const { conversationActivitiesFromCandidates } =
      await import("../src/conversation-activity-view-model");

    expect(
      conversationActivitiesFromCandidates([
        {
          id: "event_no_progress",
          seq: 1,
          type: "run.no_progress",
          label: "Run",
          summary: "Run no progress",
          tone: "info",
          createdAt: "2026-08-19T08:00:00.000Z",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ label: "运行", summary: "运行 · 无进展" }),
    ]);
  });
});

function installChineseLocale(): void {
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "zh" },
  });
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: type.startsWith("tool.") ? "tool" : "system",
    visibility: "user",
    createdAt: `2026-08-19T08:00:0${String(seq)}.000Z`,
    payload,
  };
}
