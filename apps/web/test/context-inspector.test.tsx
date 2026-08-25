import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContextInspectorObject } from "../src/ContextInspector";

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

describe("ContextInspector", () => {
  it("surfaces a single labelled context object", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    await act(async () => {
      render(
        <ContextInspector
          object={eventObject("evt-1", "助手结果", <p>事件正文</p>)}
          onClose={() => {}}
        />,
        container,
      );
    });

    const region = container.querySelector(
      ".context-inspector",
    ) as HTMLElement;
    expect(region.getAttribute("aria-label")).toBe("上下文检查器");
    expect(container.querySelector(".context-inspector-type")?.textContent).toBe(
      "事件",
    );
    expect(
      container.querySelector(".context-inspector-identity strong")?.textContent,
    ).toBe("助手结果");
    expect(container.querySelector(".context-inspector-body")?.textContent).toBe(
      "事件正文",
    );
  });

  it("renders nothing when no object is selected", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    await act(async () => {
      render(
        <ContextInspector object={undefined} onClose={() => {}} />,
        container,
      );
    });
    expect(container.querySelector(".context-inspector")).toBeNull();
  });

  it("swaps the body in place when a new object is selected", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    await act(async () => {
      render(
        <ContextInspector
          object={eventObject("evt-1", "第一个事件", <p>第一正文</p>)}
          onClose={() => {}}
        />,
        container,
      );
    });
    const first = container.querySelector(".context-inspector");

    await act(async () => {
      render(
        <ContextInspector
          object={{
            id: "tool-1",
            type: "tool",
            title: "run_command",
            content: <p>第二正文</p>,
          }}
          onClose={() => {}}
        />,
        container,
      );
    });

    // Same single column instance, updated content — no nested panels stacked.
    expect(container.querySelectorAll(".context-inspector")).toHaveLength(1);
    expect(container.querySelector(".context-inspector")).toBe(first);
    expect(container.querySelector(".context-inspector-type")?.textContent).toBe(
      "工具",
    );
    expect(container.querySelector(".context-inspector-body")?.textContent).toBe(
      "第二正文",
    );
  });

  it("returns focus to the opener when the object is cleared", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    const trigger = document.getElementById("opener") as HTMLElement;
    let focused = 0;
    trigger.focus = () => {
      focused += 1;
    };
    Object.defineProperty(document, "activeElement", {
      configurable: true,
      value: trigger,
    });

    await act(async () => {
      render(
        <ContextInspector
          object={eventObject("evt-1", "事件", <p>正文</p>)}
          onClose={() => {}}
        />,
        container,
      );
    });

    await act(async () => {
      render(
        <ContextInspector object={undefined} onClose={() => {}} />,
        container,
      );
    });

    expect(focused).toBe(1);
  });

  it("reflects and toggles pinned state through the header control", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    const toggled: boolean[] = [];
    await act(async () => {
      render(
        <ContextInspector
          object={eventObject("evt-1", "事件", <p>正文</p>)}
          pinned={true}
          onTogglePin={(next) => toggled.push(next)}
          onClose={() => {}}
        />,
        container,
      );
    });

    const pin = container.querySelector(
      ".context-inspector-pin",
    ) as HTMLButtonElement;
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(pin.getAttribute("aria-label")).toBe("取消固定");

    await act(async () => {
      pin.click();
    });
    expect(toggled).toEqual([false]);
  });

  it("requests close through the header close control", async () => {
    const container = installChineseDom();
    const { ContextInspector } = await import("../src/ContextInspector");
    let closed = 0;
    await act(async () => {
      render(
        <ContextInspector
          object={eventObject("evt-1", "事件", <p>正文</p>)}
          onClose={() => {
            closed += 1;
          }}
        />,
        container,
      );
    });

    const close = container.querySelector(
      ".context-inspector-close",
    ) as HTMLButtonElement;
    expect(close.getAttribute("aria-label")).toBe("关闭检查器");
    await act(async () => {
      close.click();
    });
    expect(closed).toBe(1);
  });
});

function eventObject(
  id: string,
  title: string,
  content: preact.ComponentChildren,
): ContextInspectorObject {
  return { id, type: "event", title, content };
}

function installChineseDom(): HTMLElement {
  vi.resetModules();
  const { document, window } = parseHTML(
    "<!doctype html><html><body><button id=opener>Open</button><div id=app></div></body></html>",
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
