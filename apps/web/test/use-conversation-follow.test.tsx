import { useRef } from "react";
import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConversationFollow } from "../src/use-conversation-follow";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useConversationFollow", () => {
  it("smoothly jumps after an explicit click while streaming follow stays instant", async () => {
    const probe = await mountProbe(false);
    probe.scrollIntoView.mockClear();

    await probe.pause();
    await probe.jump();

    expect(probe.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "end",
    });
  });

  it("uses an instant explicit jump when reduced motion is requested", async () => {
    const probe = await mountProbe(true);
    probe.scrollIntoView.mockClear();

    await probe.pause();
    await probe.jump();

    expect(probe.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "end",
    });
  });

  it("compensates for ledger height changes only while following", async () => {
    const probe = await mountProbe(false);
    probe.scrollIntoView.mockClear();

    expect(probe.resizeObserver.observed()).toBeGreaterThan(0);
    await probe.resizeObserver.trigger();
    expect(probe.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "end",
    });

    probe.scrollIntoView.mockClear();
    await probe.pause();
    await probe.resizeObserver.trigger();
    expect(probe.scrollIntoView).not.toHaveBeenCalled();
  });
});

async function mountProbe(reducedMotion: boolean) {
  const { container, window } = installDom(reducedMotion);
  const resizeObserver = stubResizeObserver();
  const scrollIntoView = vi.fn();
  const root = createRoot(container);
  roots.push(root);

  function Probe() {
    const viewportRef = useRef<HTMLElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const follow = useConversationFollow({
      endRef,
      viewportRef,
      itemCount: 2,
      streamingText: "",
      running: true,
      view: "conversation",
    });
    return (
      <section
        ref={(node) => {
          if (node) {
            Object.defineProperties(node, {
              clientHeight: { configurable: true, value: 600 },
              scrollHeight: { configurable: true, value: 1_600 },
              scrollTop: { configurable: true, writable: true, value: 1_000 },
            });
          }
          viewportRef.current = node;
        }}
        data-paused={String(follow.paused)}
      >
        <div>
          <div
            ref={(node) => {
              if (node) node.scrollIntoView = scrollIntoView;
              endRef.current = node;
            }}
          />
        </div>
        <button type="button" onClick={follow.jumpToLatest}>
          latest
        </button>
      </section>
    );
  }

  await act(async () => root.render(<Probe />));
  const viewport = container.querySelector("section") as HTMLElement;

  return {
    scrollIntoView,
    resizeObserver,
    async pause() {
      viewport.scrollTop = 100;
      await act(async () => viewport.dispatchEvent(new window.Event("scroll")));
      expect(viewport.getAttribute("data-paused")).toBe("true");
    },
    async jump() {
      const button = container.querySelector("button") as HTMLButtonElement;
      await act(async () => button.click());
    },
  };
}

function stubResizeObserver() {
  const callbacks: ResizeObserverCallback[] = [];
  let observedCount = 0;
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe() {
      observedCount += 1;
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    observed: () => observedCount,
    async trigger() {
      await act(async () => {
        for (const callback of callbacks) {
          callback([], {} as ResizeObserver);
        }
      });
    },
  };
}

function installDom(reducedMotion: boolean) {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  window.matchMedia = vi.fn(() => ({ matches: reducedMotion })) as never;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Element", window.Element);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    document,
    window,
    container: document.getElementById("app") as unknown as HTMLElement,
  };
}
