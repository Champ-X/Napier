import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThreadSummary } from "@napier/contracts";

import type { MessageView } from "../src/use-workspace-view-model";

const containers: HTMLElement[] = [];

describe("default shell Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders the startup status in Chinese", async () => {
    const container = installChineseDom();
    const { LoadingShell } = await import("../src/AppInitialStates");

    render(<LoadingShell />, container);

    expect(container.textContent).toContain("正在打开任务账本");
    expect(container.innerHTML).toContain('aria-label="正在加载 Napier"');
    expect(container.textContent).not.toContain("Opening the ledger");
  });

  it("renders workspace preview empty and relative-time states in Chinese", async () => {
    const container = installChineseDom();
    const { WorkspaceThreadPreviews } =
      await import("../src/WorkspaceThreadPreviews");

    render(
      <WorkspaceThreadPreviews threads={[]} onSelect={vi.fn()} />,
      container,
    );
    expect(container.textContent).toBe("暂无会话");

    render(
      <WorkspaceThreadPreviews
        threads={[threadSummary()]}
        onSelect={vi.fn()}
      />,
      container,
    );
    expect(container.textContent).toContain("昨天");
    expect(container.textContent).not.toContain("No sessions yet");
  });

  it("renders one contextual copy action in Chinese", async () => {
    const container = installChineseDom();
    const { ConversationMessageCard } =
      await import("../src/ConversationMessageCards");
    const message: MessageView = {
      id: "message_user_1",
      seq: 1,
      role: "user",
      text: "继续验证界面",
      model: "",
      createdAt: "2026-08-19T08:00:00.000Z",
    };

    render(
      <ConversationMessageCard
        message={message}
        workspaceLinks={[]}
        citationLinks={[]}
      />,
      container,
    );

    expect(container.textContent).toContain("操作者");
    expect(container.innerHTML).not.toContain("<details");
    expect(container.innerHTML.match(/<button\b/gu)).toHaveLength(1);
    expect(container.innerHTML).toContain('aria-label="复制"');
    expect(container.innerHTML).toContain('role="tooltip"');
    expect(container.textContent).not.toContain("Operator");
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

function threadSummary(): ThreadSummary {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  return {
    id: "thread_12345678",
    title: "昨日任务",
    agentId: "agent_default",
    status: "idle",
    createdAt: yesterday,
    updatedAt: yesterday,
    lastMessage: "完成",
    eventCount: 1,
  };
}
