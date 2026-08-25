import { useCallback, useState } from "react";

/**
 * Desktop-only shell state. Napier's supported viewport contract starts at
 * 1280px, so sidebar layout is controlled solely by the operator rather than
 * inferred from window width.
 */
export interface WorkspaceLayoutControls {
  /** Whether the sidebar should render as the compact icon rail. */
  collapsed: boolean;
  toggleSidebar(): void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [collapsed, setCollapsed] = useState(false);
  const toggleSidebar = useCallback(
    () => setCollapsed((current) => !current),
    [],
  );

  return {
    collapsed,
    toggleSidebar,
  };
}
