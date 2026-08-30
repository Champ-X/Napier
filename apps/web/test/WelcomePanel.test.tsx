import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationWorkspaceProps } from "../src/ConversationWorkspace";

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

describe("new conversation welcome", () => {
  it("offers six Chinese starter tasks and returns the selected prompt", async () => {
    const container = installChineseDom();
    const { WelcomePanel, WelcomeStarterPrompts } =
      await import("../src/WelcomePanel");
    const onSelect = vi.fn();

    await act(async () => {
      render(
        <>
          <WelcomePanel />
          <WelcomeStarterPrompts onSelect={onSelect} />
        </>,
        container,
      );
    });

    expect(container.querySelector("h2")?.textContent).toBe("今天想完成什么？");
    expect(container.querySelectorAll(".welcome-starter")).toHaveLength(6);
    expect(container.textContent).toContain("理解这个项目");
    expect(container.textContent).toContain("把目标变成计划");

    await act(async () => {
      (
        container.querySelector(
          '[data-starter-key="inspect"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(
      "检查当前工作区，梳理项目结构、主要入口和最值得关注的风险。",
    );
  });

  it("does not leak the follow badge into the empty conversation", async () => {
    const container = installChineseDom();
    vi.doMock("../src/use-conversation-follow", () => ({
      useConversationFollow: () => ({
        paused: true,
        pendingCount: 2,
        jumpToLatest: vi.fn(),
      }),
    }));
    const { ConversationWorkspace } =
      await import("../src/ConversationWorkspace");
    const vm = {
      messages: [],
      detail: { events: [] },
      isRunning: false,
      streamingText: "",
      branchFrom: vi.fn(),
      refreshActiveThread: vi.fn(),
    } as unknown as ConversationWorkspaceProps["vm"];

    await act(async () => {
      render(
        <ConversationWorkspace
          vm={vm}
          endRef={{ current: null }}
          viewportRef={{ current: null }}
          onOpenSubagentHub={() => undefined}
          onInspectArtifact={() => undefined}
        />,
        container,
      );
    });

    expect(container.querySelector(".welcome-panel")).not.toBeNull();
    expect(container.querySelector(".conversation-follow")).toBeNull();
    expect(container.textContent).not.toContain("新活动");
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
