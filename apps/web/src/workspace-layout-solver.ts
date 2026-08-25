/**
 * Pure workspace layout solver (design §7.2).
 *
 * Instead of many overlapping media queries each guessing sidebar, inspector,
 * and center widths independently, this single side-effect-free function takes
 * the viewport width plus the operator's sidebar and inspector preferences and
 * returns resolved column geometry and collapse state.
 *
 * The concession ladder mirrors the design's degradation order:
 *   1. Guarantee the center reading column its hard minimum.
 *   2. Compress the inspector from its preferred width down to its minimum.
 *   3. Auto-close the inspector (an explicit reopen control stays available).
 *   4. Collapse the sidebar from expanded to its compact icon rail.
 *   5. Below the single-column breakpoint, sidebar and inspector become
 *      overlays over one center column.
 *
 * `autoCollapsed` / `autoClosed` flag regions the solver closed because of
 * width, so the caller can restore only system-closed regions when the window
 * grows back and never fight an operator's manual close.
 */

export type SidebarPreference = "expanded" | "collapsed";
export type InspectorPreference = "open" | "closed";
export type ColumnPlacement = "inline" | "overlay";

export interface WorkspaceLayoutInput {
  /** Available shell width in CSS pixels. */
  viewportWidth: number;
  /** Operator's sidebar intent. */
  sidebarPreference: SidebarPreference;
  /** Operator's inspector intent. */
  inspectorPreference: InspectorPreference;
  /** Preferred expanded sidebar width; clamped to the sidebar range. */
  sidebarWidth?: number;
  /** Preferred open inspector width; clamped to the inspector range. */
  inspectorWidth?: number;
}

export interface ResolvedSidebar {
  placement: ColumnPlacement;
  collapsed: boolean;
  width: number;
  autoCollapsed: boolean;
}

export interface ResolvedInspector {
  placement: ColumnPlacement;
  open: boolean;
  width: number;
  autoClosed: boolean;
}

export interface WorkspaceLayout {
  mode: "regular" | "single-column";
  sidebar: ResolvedSidebar;
  inspector: ResolvedInspector;
  centerWidth: number;
}

export const WORKSPACE_LAYOUT_METRICS = {
  sidebarExpanded: 240,
  sidebarExpandedMin: 224,
  sidebarExpandedMax: 280,
  sidebarCompact: 56,
  inspectorDefault: 340,
  inspectorMin: 320,
  inspectorMax: 400,
  centerMin: 640,
  singleColumnBreakpoint: 720,
} as const;

const M = WORKSPACE_LAYOUT_METRICS;

export function resolveWorkspaceLayout(
  input: WorkspaceLayoutInput,
): WorkspaceLayout {
  const viewportWidth = Math.max(0, Math.floor(input.viewportWidth));
  if (viewportWidth < M.singleColumnBreakpoint) {
    return singleColumnLayout(viewportWidth, input);
  }
  return regularLayout(viewportWidth, input);
}

function singleColumnLayout(
  viewportWidth: number,
  input: WorkspaceLayoutInput,
): WorkspaceLayout {
  return {
    mode: "single-column",
    sidebar: {
      placement: "overlay",
      collapsed: input.sidebarPreference === "collapsed",
      width: clampSidebarWidth(input.sidebarWidth),
      autoCollapsed: false,
    },
    inspector: {
      placement: "overlay",
      open: input.inspectorPreference === "open",
      width: clampInspectorWidth(input.inspectorWidth),
      autoClosed: false,
    },
    centerWidth: viewportWidth,
  };
}

function regularLayout(
  viewportWidth: number,
  input: WorkspaceLayoutInput,
): WorkspaceLayout {
  let sidebarWidth =
    input.sidebarPreference === "expanded"
      ? clampSidebarWidth(input.sidebarWidth)
      : M.sidebarCompact;
  let sidebarAutoCollapsed = false;

  let inspectorOpen = input.inspectorPreference === "open";
  let inspectorWidth = inspectorOpen
    ? clampInspectorWidth(input.inspectorWidth)
    : 0;
  let inspectorAutoClosed = false;

  const centerWith = (sidebar: number, inspector: number) =>
    viewportWidth - sidebar - inspector;

  // Step 2: compress the inspector toward its minimum width.
  if (
    inspectorOpen &&
    centerWith(sidebarWidth, inspectorWidth) < M.centerMin &&
    centerWith(sidebarWidth, M.inspectorMin) >= M.centerMin
  ) {
    inspectorWidth = M.inspectorMin;
  }

  // Step 3: auto-close the inspector entirely.
  if (
    inspectorOpen &&
    centerWith(sidebarWidth, inspectorWidth) < M.centerMin
  ) {
    inspectorOpen = false;
    inspectorWidth = 0;
    inspectorAutoClosed = true;
  }

  // Step 4: collapse the sidebar to its compact icon rail.
  if (
    sidebarWidth > M.sidebarCompact &&
    centerWith(sidebarWidth, inspectorWidth) < M.centerMin
  ) {
    sidebarWidth = M.sidebarCompact;
    sidebarAutoCollapsed = true;
  }

  return {
    mode: "regular",
    sidebar: {
      placement: "inline",
      collapsed: sidebarWidth === M.sidebarCompact,
      width: sidebarWidth,
      autoCollapsed: sidebarAutoCollapsed,
    },
    inspector: {
      placement: "inline",
      open: inspectorOpen,
      width: inspectorWidth,
      autoClosed: inspectorAutoClosed,
    },
    centerWidth: Math.max(
      M.centerMin,
      centerWith(sidebarWidth, inspectorWidth),
    ),
  };
}

function clampSidebarWidth(width: number | undefined): number {
  return clamp(
    width ?? M.sidebarExpanded,
    M.sidebarExpandedMin,
    M.sidebarExpandedMax,
  );
}

function clampInspectorWidth(width: number | undefined): number {
  return clamp(width ?? M.inspectorDefault, M.inspectorMin, M.inspectorMax);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
