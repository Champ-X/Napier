import { useRef } from "react";
import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useComposerHeight } from "../src/use-composer-height";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useComposerHeight", () => {
  it("publishes the measured height onto the nearest app-shell", async () => {
    const { shell, container } = installDom();
    stubResizeObserver();

    await act(async () => {
      createProbe(container, 96).render();
    });

    expect(shell.style.getPropertyValue("--composer-height")).toBe("96px");
  });

  it("mirrors height changes reported by the ResizeObserver", async () => {
    const { shell, container } = installDom();
    const observer = stubResizeObserver();

    const probe = createProbe(container, 72);
    await act(async () => probe.render());
    expect(shell.style.getPropertyValue("--composer-height")).toBe("72px");

    probe.setHeight(148);
    await act(async () => observer.trigger());
    expect(shell.style.getPropertyValue("--composer-height")).toBe("148px");
  });

  it("clears the property when the composer unmounts", async () => {
    const { shell, container } = installDom();
    stubResizeObserver();

    const probe = createProbe(container, 88);
    await act(async () => probe.render());
    expect(shell.style.getPropertyValue("--composer-height")).toBe("88px");

    await act(async () => probe.root.unmount());
    roots.splice(roots.indexOf(probe.root), 1);
    expect(shell.style.getPropertyValue("--composer-height")).toBe("");
  });
});

function createProbe(container: HTMLElement, initialHeight: number) {
  let height = initialHeight;
  const root = createRoot(container);
  roots.push(root);

  function Probe() {
    const ref = useRef<HTMLFormElement>(null);
    useComposerHeight(ref);
    return (
      <form
        ref={(node) => {
          if (node) {
            (node as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
              () => ({ height }) as DOMRect;
          }
          ref.current = node;
        }}
        className="composer"
      />
    );
  }

  return {
    root,
    render: () => root.render(<Probe />),
    setHeight: (next: number) => {
      height = next;
    },
  };
}

function stubResizeObserver() {
  const callbacks: ResizeObserverCallback[] = [];
  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  return {
    trigger() {
      for (const callback of callbacks) {
        callback([], {} as ResizeObserver);
      }
    },
  };
}

function installDom() {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div class=app-shell><div id=app></div></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    shell: document.querySelector(".app-shell") as unknown as HTMLElement,
    container: document.getElementById("app") as unknown as HTMLElement,
  };
}
