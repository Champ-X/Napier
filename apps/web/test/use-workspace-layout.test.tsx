import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceLayout } from "../src/use-workspace-layout";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useWorkspaceLayout", () => {
  it.each([1280, 1440, 1920])(
    "starts expanded at the supported %dpx desktop width",
    (width) => {
      const probe = mountProbe(width);
      expect(probe.read().collapsed).toBe(false);
    },
  );

  it.each([1280, 1440, 1920])(
    "keeps the operator's sidebar choice at %dpx",
    async (width) => {
      const probe = mountProbe(width);
      await probe.toggle();
      expect(probe.read().collapsed).toBe(true);
      await probe.resizeTo(width === 1920 ? 1280 : 1920);
      expect(probe.read().collapsed).toBe(true);
    },
  );

  it("honors a manual collapse and never auto-reopens on minor width change", async () => {
    const probe = mountProbe(1920);

    await probe.toggle();
    expect(probe.read().collapsed).toBe(true);

    await probe.resizeTo(1280);
    expect(probe.read().collapsed).toBe(true);

    await probe.toggle();
    expect(probe.read().collapsed).toBe(false);
  });
});

interface ProbeReading {
  collapsed: boolean;
}

function mountProbe(initialWidth: number) {
  const { container, window } = installDom(initialWidth);
  const root = createRoot(container);
  roots.push(root);
  let toggleSidebar = () => undefined as void;

  function Probe() {
    const controls = useWorkspaceLayout();
    toggleSidebar = controls.toggleSidebar;
    return <div data-collapsed={String(controls.collapsed)} />;
  }

  const renderProbe = async () => {
    await act(async () => root.render(<Probe />));
  };
  void renderProbe();

  return {
    read(): ProbeReading {
      const node = container.firstElementChild!;
      return {
        collapsed: node.getAttribute("data-collapsed") === "true",
      };
    },
    async resizeTo(width: number) {
      window.innerWidth = width;
      await act(async () => {
        window.dispatchEvent(new window.Event("resize"));
      });
    },
    async toggle() {
      await act(async () => toggleSidebar());
    },
  };
}

function installDom(initialWidth: number) {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  window.innerWidth = initialWidth;
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return {
    container: document.getElementById("app") as unknown as HTMLElement,
    window,
  };
}
