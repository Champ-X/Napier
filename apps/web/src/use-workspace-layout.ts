import { useCallback, useEffect, useState } from "react";

import {
  resolveWorkspaceLayout,
  type SidebarPreference,
  type WorkspaceLayout,
} from "./workspace-layout-solver";

/**
 * Live shell binding for the pure {@link resolveWorkspaceLayout} solver
 * (design §7.2). The hook keeps only the operator's sidebar intent plus the
 * current viewport width and delegates every geometric decision — expanded
 * versus compact rail, and the single-column breakpoint — to the solver,
 * replacing the previous hand-guessed media-query breakpoint.
 *
 * Because the solver auto-collapses without mutating the stored preference,
 * the sidebar re-expands on its own once the window grows back and never
 * fights an operator who deliberately collapsed it.
 *
 * Below the single-column breakpoint (design §13) the sidebar leaves the shell
 * grid entirely and becomes a fixed overlay drawer over one center column. The
 * hook then exposes `overlay` plus the drawer's `navOpen` state and a
 * `closeNav` control; `toggleSidebar` opens or closes the drawer instead of
 * switching the inline preference. The drawer auto-closes when the viewport
 * grows back past the breakpoint so it never lingers over the restored grid.
 */

const SSR_FALLBACK_WIDTH = 1440;

function readViewportWidth(): number {
  return typeof window === "undefined" ? SSR_FALLBACK_WIDTH : window.innerWidth;
}

export interface WorkspaceLayoutControls {
  layout: WorkspaceLayout;
  /** Whether the sidebar should render as the compact icon rail. */
  collapsed: boolean;
  /**
   * Whether the sidebar is a fixed overlay drawer over one center column
   * (design §13, single-column mode) rather than an inline shell column.
   */
  overlay: boolean;
  /** Overlay drawer open state; always false in inline mode. */
  navOpen: boolean;
  toggleSidebar(): void;
  /** Close the overlay drawer (backdrop, escape, or navigation). */
  closeNav(): void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [sidebarPreference, setSidebarPreference] =
    useState<SidebarPreference>("expanded");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewportWidth = () => setViewportWidth(window.innerWidth);
    syncViewportWidth();
    window.addEventListener("resize", syncViewportWidth);
    return () => window.removeEventListener("resize", syncViewportWidth);
  }, []);

  const layout = resolveWorkspaceLayout({
    viewportWidth,
    sidebarPreference,
    inspectorPreference: "closed",
  });
  const overlay = layout.mode === "single-column";
  // In overlay mode the drawer shows the full-width rail, not the compact icons.
  const collapsed = overlay ? false : layout.sidebar.collapsed;

  // Never leave the drawer open once the grid is restored above the breakpoint.
  useEffect(() => {
    if (!overlay && navOpen) setNavOpen(false);
  }, [overlay, navOpen]);

  const toggleSidebar = useCallback(() => {
    if (overlay) {
      setNavOpen((open) => !open);
      return;
    }
    setSidebarPreference(collapsed ? "expanded" : "collapsed");
  }, [overlay, collapsed]);

  const closeNav = useCallback(() => setNavOpen(false), []);

  return {
    layout,
    collapsed,
    overlay,
    navOpen: overlay && navOpen,
    toggleSidebar,
    closeNav,
  };
}
