import type { RunEvent } from "@napier/contracts";
import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WebThreadDetail } from "../src/api";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Conversation Ledger milestone summaries", () => {
  it("shows the durable conclusion, suppresses its paired tool row, and retains unpaired evidence", async () => {
    const container = installChineseDom();
    const { ConversationLedger } = await import("../src/ConversationLedger");
    await act(async () => {
      render(
        <ConversationLedger
          messages={[]}
          detail={detail()}
          streamingText=""
          endRef={{ current: null }}
          onBranch={() => undefined}
          onLedgerChanged={async () => undefined}
          onOpenSubagentHub={() => undefined}
        />,
        container,
      );
    });

    const text = container.textContent ?? "";
    expect(text).toContain("阶段总结");
    expect(text).toContain("已确认实现路径");
    expect(text).toContain("现有里程碑账本可以直接承载阶段进展");
    expect(text).toContain("1 项已完成");
    expect(text).toContain("1 项待处理");
    expect(container.querySelectorAll(".conversation-milestone")).toHaveLength(
      1,
    );
    expect(
      container.querySelectorAll(".conversation-tool-activity"),
    ).toHaveLength(1);
    expect(text).toContain("已记录运行里程碑");
  });
});

function detail(): WebThreadDetail {
  const events = [
    event(1, "tool.started", {
      callId: "call_milestone",
      toolName: "record_run_milestone",
      status: "started",
    }),
    event(2, "agent.milestone.recorded", {
      kind: "napier.agent-milestone-recorded",
      schemaVersion: 1,
      milestoneId: "milestone_12345678",
      phase: "execution",
      title: "已确认实现路径",
      summary: "现有里程碑账本可以直接承载阶段进展，不需要从私有推理中猜测。",
      completedItems: ["完成事件链路审计"],
      openLoops: ["接入主时间线并验证"],
    }),
    event(3, "tool.completed", {
      callId: "call_milestone",
      toolName: "record_run_milestone",
      status: "completed",
    }),
    event(4, "tool.started", {
      callId: "call_unpaired_milestone",
      toolName: "record_run_milestone",
      status: "started",
    }),
    event(5, "tool.completed", {
      callId: "call_unpaired_milestone",
      toolName: "record_run_milestone",
      status: "completed",
    }),
  ];
  return {
    thread: {
      id: "thread_1",
      title: "Milestone projection",
      agentId: "agent_1",
      status: "idle",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:03.000Z",
      lastMessage: "",
      eventCount: events.length,
      runIds: ["run_1"],
    },
    events,
    runs: [],
    plans: [],
    operatorDecisions: [],
    subagents: [],
    automaticRecoveryAssessments: [],
    automaticRecoveryAttempts: [],
  } as unknown as WebThreadDetail;
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
    category: type.startsWith("tool.") ? "tool" : "plan",
    visibility: "user",
    createdAt: `2026-08-30T00:00:${String(seq).padStart(2, "0")}.000Z`,
    payload,
  };
}

function installChineseDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
