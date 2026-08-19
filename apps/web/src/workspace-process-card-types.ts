import type { useProcessPanel } from "./use-process-panel";

export type WorkspaceProcessPanelState = ReturnType<typeof useProcessPanel>;
export type WorkspaceProcessCardView =
  WorkspaceProcessPanelState["cards"][number];
export type WorkspaceProcessSession =
  WorkspaceProcessPanelState["sessions"][number];
