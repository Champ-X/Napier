import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceLayout,
  WORKSPACE_LAYOUT_METRICS as M,
  type WorkspaceLayoutInput,
} from "../src/workspace-layout-solver";

function input(overrides: Partial<WorkspaceLayoutInput>): WorkspaceLayoutInput {
  return {
    viewportWidth: 1440,
    sidebarPreference: "expanded",
    inspectorPreference: "open",
    ...overrides,
  };
}

describe("resolveWorkspaceLayout", () => {
  it("keeps all three inline columns at a wide desktop width", () => {
    const layout = resolveWorkspaceLayout(input({ viewportWidth: 1920 }));

    expect(layout.mode).toBe("regular");
    expect(layout.sidebar).toMatchObject({
      placement: "inline",
      collapsed: false,
      width: M.sidebarExpanded,
      autoCollapsed: false,
    });
    expect(layout.inspector).toMatchObject({
      placement: "inline",
      open: true,
      width: M.inspectorDefault,
      autoClosed: false,
    });
    expect(layout.centerWidth).toBeGreaterThanOrEqual(M.centerMin);
    expect(layout.centerWidth).toBe(
      1920 - M.sidebarExpanded - M.inspectorDefault,
    );
  });

  it("clamps sidebar and inspector preferences into their ranges", () => {
    const layout = resolveWorkspaceLayout(
      input({ viewportWidth: 2200, sidebarWidth: 999, inspectorWidth: 10 }),
    );

    expect(layout.sidebar.width).toBe(M.sidebarExpandedMax);
    expect(layout.inspector.width).toBe(M.inspectorMin);
  });

  it("compresses the inspector before closing it", () => {
    // Width where a default inspector overflows the center min but a minimum
    // inspector still fits: center_min + sidebar + inspector_min.
    const viewportWidth = M.centerMin + M.sidebarExpanded + M.inspectorMin;
    const layout = resolveWorkspaceLayout(input({ viewportWidth }));

    expect(layout.inspector.open).toBe(true);
    expect(layout.inspector.width).toBe(M.inspectorMin);
    expect(layout.inspector.autoClosed).toBe(false);
    expect(layout.centerWidth).toBe(M.centerMin);
  });

  it("auto-closes the inspector when even its minimum will not fit", () => {
    // Enough room for an expanded sidebar and the center min, but not the
    // inspector minimum on top.
    const viewportWidth =
      M.centerMin + M.sidebarExpanded + M.inspectorMin - 40;
    const layout = resolveWorkspaceLayout(input({ viewportWidth }));

    expect(layout.inspector.open).toBe(false);
    expect(layout.inspector.width).toBe(0);
    expect(layout.inspector.autoClosed).toBe(true);
    expect(layout.sidebar.collapsed).toBe(false);
    expect(layout.centerWidth).toBeGreaterThanOrEqual(M.centerMin);
  });

  it("collapses the sidebar only after the inspector is already closed", () => {
    // Regular mode (>= breakpoint) but too narrow for an expanded sidebar:
    // center_min + compact rail fits, center_min + expanded sidebar does not.
    const viewportWidth = 820;
    expect(viewportWidth).toBeGreaterThanOrEqual(M.singleColumnBreakpoint);
    expect(viewportWidth).toBeLessThan(M.centerMin + M.sidebarExpanded);
    const layout = resolveWorkspaceLayout(input({ viewportWidth }));

    expect(layout.inspector.open).toBe(false);
    expect(layout.inspector.autoClosed).toBe(true);
    expect(layout.sidebar.collapsed).toBe(true);
    expect(layout.sidebar.width).toBe(M.sidebarCompact);
    expect(layout.sidebar.autoCollapsed).toBe(true);
    expect(layout.centerWidth).toBeGreaterThanOrEqual(M.centerMin);
  });

  it("switches to overlay columns below the single-column breakpoint", () => {
    const layout = resolveWorkspaceLayout(
      input({ viewportWidth: M.singleColumnBreakpoint - 1 }),
    );

    expect(layout.mode).toBe("single-column");
    expect(layout.sidebar.placement).toBe("overlay");
    expect(layout.inspector.placement).toBe("overlay");
    expect(layout.centerWidth).toBe(M.singleColumnBreakpoint - 1);
  });

  it("never auto-reopens a region the operator closed, and reopens system-closed regions when width returns", () => {
    // Operator collapsed the sidebar and closed the inspector: even at a wide
    // width they stay as the operator left them.
    const wide = resolveWorkspaceLayout(
      input({
        viewportWidth: 1920,
        sidebarPreference: "collapsed",
        inspectorPreference: "closed",
      }),
    );
    expect(wide.sidebar.collapsed).toBe(true);
    expect(wide.sidebar.autoCollapsed).toBe(false);
    expect(wide.inspector.open).toBe(false);
    expect(wide.inspector.autoClosed).toBe(false);

    // A region the solver auto-closed at a narrow width (preference still
    // "open") reopens once the width grows back.
    const narrow = resolveWorkspaceLayout(
      input({ viewportWidth: M.centerMin + M.sidebarExpanded + 10 }),
    );
    expect(narrow.inspector.autoClosed).toBe(true);
    const regrown = resolveWorkspaceLayout(input({ viewportWidth: 1920 }));
    expect(regrown.inspector.open).toBe(true);
    expect(regrown.inspector.autoClosed).toBe(false);
  });
});
