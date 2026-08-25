import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("ConversationFollowButton", () => {
  it("stays hidden while auto-follow is active", async () => {
    const container = installChineseDom();
    const { ConversationFollowButton } = await import(
      "../src/ConversationFollowButton"
    );
    await act(async () => {
      render(
        <ConversationFollowButton
          paused={false}
          pendingCount={3}
          onJump={() => {}}
        />,
        container,
      );
    });
    expect(container.querySelector(".conversation-follow")).toBeNull();
  });

  it("shows the pending count in Chinese and resumes following on click", async () => {
    const container = installChineseDom();
    const { ConversationFollowButton } = await import(
      "../src/ConversationFollowButton"
    );
    const jumps: number[] = [];
    await act(async () => {
      render(
        <ConversationFollowButton
          paused={true}
          pendingCount={4}
          onJump={() => jumps.push(1)}
        />,
        container,
      );
    });
    expect(container.textContent).toContain("新活动 · 4");
    expect(container.textContent).not.toContain("New activity");
    const button = container.querySelector(
      ".conversation-follow-button",
    ) as HTMLButtonElement;
    await act(async () => {
      button.click();
    });
    expect(jumps).toEqual([1]);
  });

  it("offers a plain resume label when nothing is pending", async () => {
    const container = installChineseDom();
    const { ConversationFollowButton } = await import(
      "../src/ConversationFollowButton"
    );
    await act(async () => {
      render(
        <ConversationFollowButton
          paused={true}
          pendingCount={0}
          onJump={() => {}}
        />,
        container,
      );
    });
    expect(container.textContent).toContain("回到最新");
    expect(container.textContent).not.toContain("·");
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
