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
 * The inspector remains an independently owned fixed overlay, so it is modelled
 * as closed here and does not consume the shell grid's center width; it joins
 * the solved geometry with the ContentAxis migration (WEB-UI-002). Until the
 * single-column overlay lands (WEB-UI-009), the compact icon rail also serves
 * as the fallback below the single-column breakpoint.
 */

const SSR_FALLBACK_WIDTH = 1440;

function readViewportWidth(): number {
  return typeof window === "undefined" ? SSR_FALLBACK_WIDTH : window.innerWidth;
}

export interface WorkspaceLayoutControls {
  layout: WorkspaceLayout;
  /** Whether the sidebar should render as the compact icon rail. */
  collapsed: boolean;
  toggleSidebar(): void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [sidebarPreference, setSidebarPreference] =
    useState<SidebarPreference>("expanded");

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
  const collapsed =
    layout.mode === "single-column" || layout.sidebar.collapsed;

  const toggleSidebar = useCallback(() => {
    setSidebarPreference(collapsed ? "expanded" : "collapsed");
  }, [collapsed]);

  return { layout, collapsed, toggleSidebar };
}
