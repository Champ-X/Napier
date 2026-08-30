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

/**
 * Desktop-only shell state. Napier's supported viewport contract starts at
 * 1280px, so sidebar layout is controlled solely by the operator rather than
 * inferred from window width.
 */
export interface WorkspaceLayoutControls {
  /** Whether the sidebar should render as the compact icon rail. */
  collapsed: boolean;
  navigationWidth: number;
  navigationMax: number;
  evidenceWidth: number;
  evidenceMax: number;
  toggleSidebar(): void;
  setNavigationWidth(width: number): void;
  setEvidenceWidth(width: number): void;
  resetNavigationWidth(): void;
  resetEvidenceWidth(): void;
}

export function useWorkspaceLayout(): WorkspaceLayoutControls {
  const [collapsed, setCollapsed] = useState(false);
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
  const toggleSidebar = useCallback(
    () => setCollapsed((current) => !current),
    [],
  );
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

  return {
    collapsed,
    navigationWidth,
    navigationMax,
    evidenceWidth,
    evidenceMax,
    toggleSidebar,
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
      viewportWidth -
        WORKSPACE_CENTER_MIN_WIDTH -
        WORKSPACE_EVIDENCE_WIDTH.min,
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
  return typeof window === "undefined"
    ? 1920
    : Math.max(window.innerWidth, WORKSPACE_CENTER_MIN_WIDTH);
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
