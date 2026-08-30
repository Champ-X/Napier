import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationBrowserActivity } from "../src/conversation-browser-activity-view-model";
import type { ConversationNetworkActivity } from "../src/conversation-network-activity-view-model";
import type { ConversationToolActivity } from "../src/conversation-tool-activity-view-model";
import type { ConversationThinkingActivity as ThinkingActivity } from "../src/conversation-thinking-view-model";

const containers: HTMLElement[] = [];

describe("conversation activity Chinese copy", () => {
  afterEach(async () => {
    await Promise.all(
      containers.splice(0).map(async (container) => {
        await act(async () => render(null, container));
      }),
    );
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders web search evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationNetworkActivityCard } =
      await import("../src/ConversationNetworkActivityCard");

    await act(async () => {
      render(
        <ConversationNetworkActivityCard activity={networkActivity()} />,
        container,
      );
    });
    const text = container.textContent ?? "";

    expect(text).toContain("找到 3 条结果 · 来源 brave");
    expect(text).not.toContain("网页搜索 · 已完成");
    expect(text).toContain("提供方");
    expect(text).toContain("外部页面和摘要是不可信证据");
    expect(text).not.toContain("Web search");
  });

  it("renders browser takeover evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationBrowserActivityCard } =
      await import("../src/ConversationBrowserActivityCard");

    await act(async () => {
      render(
        <ConversationBrowserActivityCard activity={browserActivity()} />,
        container,
      );
    });
    const text = container.textContent ?? "";

    expect(text).toContain("已读取页面 · 需要登录");
    expect(text).not.toContain("浏览器 · 已完成");
    expect(text).toContain("需要登录");
    expect(text).toContain("浏览器实时视图中接管");
    expect(text).toContain("标签页");
    expect(text).not.toContain("Login or challenge detected");
  });

  it("renders bounded command evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationToolActivityCard } =
      await import("../src/ConversationToolActivityCard");

    await act(async () => {
      render(<ConversationToolActivityCard activity={toolActivity()} />, container);
    });
    const text = container.textContent ?? "";

    expect(text).toContain("命令 成功");
    expect(text).not.toContain("命令 · 已完成");
    expect(text).toContain("只读");
    expect(text).toContain("已拒绝");
    expect(text).not.toContain("Shell · completed");
  });

  it("renders known workflow tools as natural Chinese actions", async () => {
    const container = installChineseDom();
    const { ConversationToolActivityCard } =
      await import("../src/ConversationToolActivityCard");

    await act(async () => {
      render(
        <ConversationToolActivityCard
          activity={{
            ...toolActivity(),
            kind: "tool",
            toolName: "update_plan_artifact",
          }}
        />,
        container,
      );
    });
    const text = container.textContent ?? "";

    expect(text).toContain("已更新计划产物");
    expect(text).not.toContain("Update plan artifact已完成");
  });

  it("renders patch activity without mixed-language concatenation", async () => {
    const container = installChineseDom();
    const { ConversationToolActivityCard } =
      await import("../src/ConversationToolActivityCard");

    await act(async () => {
      render(
        <ConversationToolActivityCard
          activity={{
            ...toolActivity(),
            kind: "tool",
            toolName: "apply_patch",
          }}
        />,
        container,
      );
    });
    const text = container.textContent ?? "";

    expect(text).toContain("已应用补丁");
    expect(text).not.toContain("Apply patch已完成");
  });

  it("localizes known tool names in failure states", async () => {
    const container = installChineseDom();
    const { ConversationToolActivityCard } =
      await import("../src/ConversationToolActivityCard");

    await act(async () => {
      render(
        <ConversationToolActivityCard
          activity={{
            ...toolActivity(),
            kind: "tool",
            status: "failed",
            toolName: "apply_patch",
          }}
        />,
        container,
      );
    });
    const text = container.textContent ?? "";

    expect(text).toContain("应用补丁 · 运行失败");
    expect(text).not.toContain("Apply patch");
  });

  it("renders the complete retained thinking transcript", async () => {
    const container = installChineseDom();
    const { ConversationThinkingActivity } =
      await import("../src/ConversationThinkingActivity");
    const activity: ThinkingActivity = {
      id: "event_thinking",
      runId: "run_1",
      seq: 2,
      lastSeq: 2,
      createdAt: "2026-08-19T08:01:00.000Z",
      summaryKind: "edit",
      followingActionKind: "apply_patch",
      durationSeconds: 7,
      chunkCount: 8,
      deltaBytes: 212,
      transcript: "先检查现有实现，再修改运行时投影并完成验证。",
    };

    await act(async () => {
      render(<ConversationThinkingActivity activity={activity} />, container);
    });
    const text = container.textContent ?? "";

    expect(text).toContain("思考了 7 秒");
    expect(text).toContain("先检查现有实现，再修改运行时投影并完成验证。");
    expect(text).not.toContain("思考内容");
    expect(text).not.toContain("随后动作");
    expect(text).not.toContain("运行依据");
    expect(text).not.toContain("来自模型实际返回");
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);

    await act(async () => {
      render(
        <ConversationThinkingActivity activity={activity} active />,
        container,
      );
    });
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("groups adjacent verification evidence with Chinese labels", async () => {
    const container = installChineseDom();
    const { groupConversationFeed } =
      await import("../src/conversation-feed-grouping");
    const { ConversationActivityGroupCard } =
      await import("../src/ConversationActivityGroupCard");
    const first = toolActivity();
    const second: ConversationToolActivity = {
      ...toolActivity(),
      id: "event_tool_2",
      callId: "call_tool_2",
      seq: 4,
      createdAt: "2026-08-19T08:03:00.000Z",
    };
    const [group] = groupConversationFeed([
      { kind: "tool", seq: first.seq, activity: first },
      { kind: "tool", seq: second.seq, activity: second },
    ]);
    if (!group || group.kind !== "activity-group") {
      throw new Error("Expected adjacent tool evidence to be grouped");
    }

    await act(async () => {
      render(<ConversationActivityGroupCard group={group} />, container);
    });
    const text = container.textContent ?? "";

    expect(text).toContain("验证 · 2 步");
    expect(text).not.toContain("验证 · 已分组");
    expect(text).not.toContain("显示证据");
    expect(text).not.toContain("Verify · 2 steps");
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

function networkActivity(): ConversationNetworkActivity {
  return {
    kind: "search",
    id: "event_search",
    callId: "call_search",
    seq: 1,
    createdAt: "2026-08-19T08:00:00.000Z",
    status: "completed",
    provider: "brave",
    category: "general",
    resultCount: 3,
    attemptedProviderCount: 1,
    failedProviderCount: 0,
    unavailableProviderCount: 0,
    retrievedAt: "2026-08-19T08:00:00.000Z",
  };
}

function browserActivity(): ConversationBrowserActivity {
  return {
    id: "event_browser",
    callId: "call_browser",
    seq: 2,
    createdAt: "2026-08-19T08:01:00.000Z",
    status: "completed",
    action: "snapshot",
    operation: 2,
    sessionReused: true,
    activeTabId: "tab_12345678",
    tabCount: 2,
    pageDiagnosis: "login_required",
    takeoverRecommended: true,
  };
}

function toolActivity(): ConversationToolActivity {
  return {
    id: "event_tool",
    callId: "call_tool",
    seq: 3,
    createdAt: "2026-08-19T08:02:00.000Z",
    kind: "shell",
    status: "completed",
    toolName: "run_command",
    evidence: {
      effect: "read",
      commandRuntime: "node",
      commandStatus: "succeeded",
      commandArgumentCount: 2,
      commandExitCode: 0,
      commandTimeoutMs: 30_000,
      commandWorkspaceAccess: "read_only",
      commandNetworkAccess: "denied",
    },
    receipt: "tool / run_command / completed",
    eventIds: ["event_tool"],
  };
}
