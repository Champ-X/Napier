import { parseHTML } from "linkedom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WORKSPACE_LAYOUT_METRICS as M } from "../src/workspace-layout-solver";
import { useWorkspaceLayout } from "../src/use-workspace-layout";

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useWorkspaceLayout", () => {
  it("expands the sidebar inline at a wide desktop width", async () => {
    const probe = mountProbe(1920);

    expect(probe.read().collapsed).toBe(false);
    expect(probe.read().mode).toBe("regular");
    expect(probe.read().sidebarWidth).toBe(M.sidebarExpanded);
  });

  it("collapses to the compact rail when the window is auto-narrowed", async () => {
    const probe = mountProbe(1920);
    expect(probe.read().collapsed).toBe(false);

    await probe.resizeTo(820);

    expect(probe.read().collapsed).toBe(true);
    expect(probe.read().sidebarWidth).toBe(M.sidebarCompact);
    expect(probe.read().autoCollapsed).toBe(true);
  });

  it("re-expands on its own after an auto-collapse when width returns", async () => {
    const probe = mountProbe(820);
    expect(probe.read().collapsed).toBe(true);
    expect(probe.read().autoCollapsed).toBe(true);

    await probe.resizeTo(1920);

    expect(probe.read().collapsed).toBe(false);
    expect(probe.read().autoCollapsed).toBe(false);
  });

  it("honors a manual collapse and never auto-reopens on minor width change", async () => {
    const probe = mountProbe(1920);

    await probe.toggle();
    expect(probe.read().collapsed).toBe(true);
    expect(probe.read().autoCollapsed).toBe(false);

    // A wider window still respects the operator's manual collapse.
    await probe.resizeTo(2200);
    expect(probe.read().collapsed).toBe(true);
    expect(probe.read().autoCollapsed).toBe(false);

    // Toggling back returns to the expanded rail.
    await probe.toggle();
    expect(probe.read().collapsed).toBe(false);
  });

  it("becomes a closed overlay drawer below the single-column breakpoint", async () => {
    const probe = mountProbe(M.singleColumnBreakpoint - 1);

    expect(probe.read().mode).toBe("single-column");
    // The drawer shows the full-width rail (not the compact icons) and starts
    // closed; `overlay` signals the shell to drop the sidebar grid column.
    expect(probe.read().overlay).toBe(true);
    expect(probe.read().collapsed).toBe(false);
    expect(probe.read().navOpen).toBe(false);
  });

  it("toggles the overlay drawer open and closed without changing inline preference", async () => {
    const probe = mountProbe(M.singleColumnBreakpoint - 1);
    expect(probe.read().navOpen).toBe(false);

    await probe.toggle();
    expect(probe.read().navOpen).toBe(true);

    await probe.toggle();
    expect(probe.read().navOpen).toBe(false);
  });

  it("auto-dismisses the overlay drawer when the viewport is restored", async () => {
    const probe = mountProbe(M.singleColumnBreakpoint - 1);
    await probe.toggle();
    expect(probe.read().navOpen).toBe(true);

    await probe.resizeTo(1920);

    expect(probe.read().overlay).toBe(false);
    expect(probe.read().navOpen).toBe(false);
  });
});

interface ProbeReading {
  collapsed: boolean;
  mode: string;
  sidebarWidth: number;
  autoCollapsed: boolean;
  overlay: boolean;
  navOpen: boolean;
}

function mountProbe(initialWidth: number) {
  const { container, window } = installDom(initialWidth);
  const root = createRoot(container);
  roots.push(root);
  let toggleSidebar = () => undefined as void;

  function Probe() {
    const controls = useWorkspaceLayout();
    toggleSidebar = controls.toggleSidebar;
    return (
      <div
        data-collapsed={String(controls.collapsed)}
        data-mode={controls.layout.mode}
        data-sidebar-width={String(controls.layout.sidebar.width)}
        data-auto-collapsed={String(controls.layout.sidebar.autoCollapsed)}
        data-overlay={String(controls.overlay)}
        data-nav-open={String(controls.navOpen)}
      />
    );
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
        mode: node.getAttribute("data-mode") ?? "",
        sidebarWidth: Number(node.getAttribute("data-sidebar-width")),
        autoCollapsed: node.getAttribute("data-auto-collapsed") === "true",
        overlay: node.getAttribute("data-overlay") === "true",
        navOpen: node.getAttribute("data-nav-open") === "true",
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
