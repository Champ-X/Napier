import { useCallback, useEffect, useState } from "react";

export const WORKSPACE_CENTER_MIN_WIDTH = 640;

export const WORKSPACE_NAVIGATION_WIDTH = {
  min: 232,
  default: 252,
  max: 480,
} as const;

export const WORKSPACE_EVIDENCE_WIDTH = {
  min: 360,
  default: 760,
} as const;

const NAVIGATION_WIDTH_KEY = "napier.workspace.navigation-width";
const EVIDENCE_WIDTH_KEY = "napier.workspace.evidence-width";
const COMPACT_VIEWPORT_MAX = 720;
const WORKSPACE_RAIL_VIEWPORT_MIN =
  WORKSPACE_NAVIGATION_WIDTH.default +
  WORKSPACE_CENTER_MIN_WIDTH +
  WORKSPACE_EVIDENCE_WIDTH.min;

/**
 * Operator-controlled desktop shell state with a compact safety rail for
 * narrow windows. Returning to desktop restores the operator's last choice.
 */
export interface WorkspaceLayoutControls {
  /** Whether the sidebar should render as the compact icon rail. */
  collapsed: boolean;
  compactViewport: boolean;
  mobileNavigationOpen: boolean;
  navigationWidth: number;
  navigationMax: number;
  evidenceWidth: number;
  evidenceMax: number;
  /** Whether the viewport can render the evidence rail without hiding it. */
  workspaceRailAvailable: boolean;
  toggleSidebar(): void;
  openSidebar(): void;
  closeSidebar(): void;
  setNavigationWidth(width: number): void;
  setEvidenceWidth(width: number): void;
  resetNavigationWidth(): void;
  resetEvidenceWidth(): void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth);
  const [preferredNavigationWidth, setNavigationWidthState] = useState(() =>
    readStoredWidth(NAVIGATION_WIDTH_KEY, WORKSPACE_NAVIGATION_WIDTH),
  );
  const [preferredEvidenceWidth, setEvidenceWidthState] = useState(() =>
    readStoredWidth(EVIDENCE_WIDTH_KEY, WORKSPACE_EVIDENCE_WIDTH),
  );
  const navigationMax = availableNavigationMax(viewportWidth);
  const navigationWidth = clampWidth(preferredNavigationWidth, {
    ...WORKSPACE_NAVIGATION_WIDTH,
    max: navigationMax,
  });
  const evidenceMax = availableEvidenceMax(viewportWidth, navigationWidth);
  const evidenceWidth = clampWidth(preferredEvidenceWidth, {
    ...WORKSPACE_EVIDENCE_WIDTH,
    max: evidenceMax,
  });
  const compactViewport = viewportWidth < COMPACT_VIEWPORT_MAX;
  const collapsed = manuallyCollapsed || compactViewport;
  const workspaceRailAvailable = viewportWidth >= WORKSPACE_RAIL_VIEWPORT_MIN;
  const toggleSidebar = useCallback(() => {
    if (compactViewport) {
      setMobileNavigationOpen((current) => !current);
      return;
    }
    setManuallyCollapsed((current) => !current);
  }, [compactViewport]);
  const openSidebar = useCallback(() => {
    if (compactViewport) setMobileNavigationOpen(true);
    else setManuallyCollapsed(false);
  }, [compactViewport]);
  const closeSidebar = useCallback(() => setMobileNavigationOpen(false), []);
  const setNavigationWidth = useCallback((width: number) => {
    setNavigationWidthState(clampWidth(width, WORKSPACE_NAVIGATION_WIDTH));
  }, []);
  const setEvidenceWidth = useCallback((width: number) => {
    setEvidenceWidthState(clampWidth(width, WORKSPACE_EVIDENCE_WIDTH));
  }, []);
  const resetNavigationWidth = useCallback(
    () => setNavigationWidthState(WORKSPACE_NAVIGATION_WIDTH.default),
    [],
  );
  const resetEvidenceWidth = useCallback(
    () => setEvidenceWidthState(WORKSPACE_EVIDENCE_WIDTH.default),
    [],
  );

  useEffect(
    () => storeWidth(NAVIGATION_WIDTH_KEY, preferredNavigationWidth),
    [preferredNavigationWidth],
  );
  useEffect(
    () => storeWidth(EVIDENCE_WIDTH_KEY, preferredEvidenceWidth),
    [preferredEvidenceWidth],
  );
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(readViewportWidth());
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);
  useEffect(() => {
    if (!compactViewport) setMobileNavigationOpen(false);
  }, [compactViewport]);

  return {
    collapsed,
    compactViewport,
    mobileNavigationOpen,
    navigationWidth,
    navigationMax,
    evidenceWidth,
    evidenceMax,
    workspaceRailAvailable,
    toggleSidebar,
    openSidebar,
    closeSidebar,
    setNavigationWidth,
    setEvidenceWidth,
    resetNavigationWidth,
    resetEvidenceWidth,
  };
}

function availableNavigationMax(viewportWidth: number): number {
  return Math.max(
    WORKSPACE_NAVIGATION_WIDTH.min,
    Math.min(
      WORKSPACE_NAVIGATION_WIDTH.max,
      viewportWidth - WORKSPACE_CENTER_MIN_WIDTH - WORKSPACE_EVIDENCE_WIDTH.min,
    ),
  );
}

function availableEvidenceMax(
  viewportWidth: number,
  navigationWidth: number,
): number {
  return Math.max(
    WORKSPACE_EVIDENCE_WIDTH.min,
    Math.min(
      Math.floor(viewportWidth / 2),
      viewportWidth - navigationWidth - WORKSPACE_CENTER_MIN_WIDTH,
    ),
  );
}

function readViewportWidth(): number {
  return typeof window === "undefined" ? 1920 : Math.max(window.innerWidth, 1);
}

interface WidthBounds {
  min: number;
  default: number;
  max?: number;
}

function clampWidth(width: number, bounds: WidthBounds): number {
  if (!Number.isFinite(width)) return bounds.default;
  const normalized = Math.max(bounds.min, Math.round(width));
  return bounds.max === undefined
    ? normalized
    : Math.min(bounds.max, normalized);
}

function readStoredWidth(key: string, bounds: WidthBounds): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return value > 0 ? clampWidth(value, bounds) : bounds.default;
  } catch {
    return bounds.default;
  }
}

function storeWidth(key: string, width: number): void {
  try {
    window.localStorage.setItem(key, String(width));
  } catch {
    // Storage can be disabled. The in-memory layout remains fully usable.
  }
}
