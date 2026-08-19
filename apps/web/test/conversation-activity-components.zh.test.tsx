import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationBrowserActivity } from "../src/conversation-browser-activity-view-model";
import type { ConversationNetworkActivity } from "../src/conversation-network-activity-view-model";
import type { ConversationToolActivity } from "../src/conversation-tool-activity-view-model";

const containers: HTMLElement[] = [];

describe("conversation activity Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders web search evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationNetworkActivityCard } =
      await import("../src/ConversationNetworkActivityCard");

    render(
      <ConversationNetworkActivityCard activity={networkActivity()} />,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("网页搜索 · 已完成");
    expect(text).toContain("3 条结果 · 来源 brave");
    expect(text).toContain("提供方");
    expect(text).toContain("外部页面和摘要是不可信证据");
    expect(text).not.toContain("Web search");
  });

  it("renders browser takeover evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationBrowserActivityCard } =
      await import("../src/ConversationBrowserActivityCard");

    render(
      <ConversationBrowserActivityCard activity={browserActivity()} />,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("浏览器 · 已完成");
    expect(text).toContain("需要登录");
    expect(text).toContain("浏览器实时视图中接管");
    expect(text).toContain("标签页");
    expect(text).not.toContain("Login or challenge detected");
  });

  it("renders bounded command evidence in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationToolActivityCard } =
      await import("../src/ConversationToolActivityCard");

    render(
      <ConversationToolActivityCard activity={toolActivity()} />,
      container,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("命令 · 已完成");
    expect(text).toContain("命令 成功");
    expect(text).toContain("只读");
    expect(text).toContain("已拒绝");
    expect(text).not.toContain("Shell · completed");
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

    render(<ConversationActivityGroupCard group={group} />, container);
    const text = container.textContent ?? "";

    expect(text).toContain("验证 · 已分组");
    expect(text).toContain("验证 · 2 步");
    expect(text).toContain("显示证据");
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
