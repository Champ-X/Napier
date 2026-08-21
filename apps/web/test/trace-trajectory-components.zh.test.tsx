import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TraceTrajectoryEvent } from "../src/trace-trajectory-model";

const containers: HTMLElement[] = [];

describe("trajectory Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders lane, detail, and search controls in Chinese", async () => {
    const container = installChineseDom();
    const { TraceTrajectoryControls } =
      await import("../src/TraceTrajectoryControls");

    render(
      <TraceTrajectoryControls
        events={[]}
        activeLanes={["input", "model", "tools"]}
        viewMode="key"
        keyEventCount={0}
        query=""
        searchInputRef={{ current: null }}
        onToggleLane={vi.fn()}
        onViewMode={vi.fn()}
        onQuery={vi.fn()}
      />,
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("输入");
    expect(text).toContain("模型");
    expect(text).toContain("工具");
    expect(text).toContain("关键");
    expect(text).toContain("全部");
    expect(container.innerHTML).toContain('placeholder="查找动作或工具"');
    expect(container.innerHTML).toContain('aria-label="可见动作层"');
    expect(text).not.toContain("Visible action lanes");
  });

  it("renders run status, turn, event count, and audit labels in Chinese", async () => {
    const container = installChineseDom();
    const { TraceTrajectoryRunSection } =
      await import("../src/TraceTrajectoryLedger");
    const event = trajectoryEvent();

    render(
      <TraceTrajectoryRunSection
        run={{
          id: "run_12345678",
          ordinal: 1,
          status: "completed",
          durationMs: 1200,
          events: [event],
          turns: [{ index: 1, label: "Turn 1", events: [event] }],
        }}
        selectedEventId={event.event.id}
        visibleEventIds={new Set([event.event.id])}
        forceOpen
        latest
        onSelect={vi.fn()}
      />,
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("运行 1");
    expect(text).toContain("已完成");
    expect(text).toContain("轮次 1");
    expect(text).toContain("1 个事件");
    expect(text).not.toContain("摘要来源");
  });

  it("renders a four-section event inspector with bounded evidence", async () => {
    const container = installChineseDom();
    const { TraceTrajectoryEventDetail } =
      await import("../src/TraceTrajectoryEventDetail");
    const event = trajectoryEvent();
    event.event.type = "model.response";
    event.event.payload = {
      model: "deepseek-v4-flash",
      stopReason: "toolUse",
      modelContextEnvelopeTurnIndex: 1,
      usage: { inputTokens: 6873, outputTokens: 1217 },
      textSha256: "a".repeat(64),
      privateText: "TOP_SECRET_MODEL_OUTPUT",
    };

    render(<TraceTrajectoryEventDetail event={event} />, container);
    const text = container.textContent ?? "";
    expect(text).toContain("摘要");
    expect(text).toContain("上下文");
    expect(text).toContain("证据");
    expect(text).toContain("计时");
    expect(text).toContain("任务完成。");
    expect(text).not.toContain("TOP_SECRET_MODEL_OUTPUT");

    const evidenceTab = [...container.querySelectorAll('[role="tab"]')].find(
      (candidate) => candidate.textContent?.includes("证据"),
    ) as HTMLButtonElement;
    evidenceTab.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    const evidence = container.textContent ?? "";
    expect(evidence).toContain("模型");
    expect(evidence).toContain("输入 Token");
    expect(evidence).toContain("文本 SHA-256");
    expect(evidence).toContain("deepseek-v4-flash");
    expect(evidence).toContain("6873");
    expect(evidence).toContain("aaaaaaaaaaaa…");
    expect(evidence).not.toContain("INPUT TOKENS");
    expect(evidence).not.toContain("TOP_SECRET_MODEL_OUTPUT");
  });
});

function installChineseDom(): HTMLElement {
  vi.resetModules();
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
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}

function trajectoryEvent(): TraceTrajectoryEvent {
  return {
    event: {
      id: "event_12345678",
      threadId: "thread_12345678",
      runId: "run_12345678",
      seq: 1,
      type: "message.assistant",
      category: "message",
      visibility: "user",
      createdAt: "2026-08-19T08:00:00.000Z",
      payload: {},
    },
    summary: "任务完成。",
    summarySource: "fixed",
    lane: "model",
    role: "ASSISTANT",
    label: "助手结果",
    turnIndex: 1,
    timestampMs: Date.parse("2026-08-19T08:00:00.000Z"),
    status: "completed",
    durationMs: 1200,
  };
}
