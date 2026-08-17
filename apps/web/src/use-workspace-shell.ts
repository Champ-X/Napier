import { useCallback, useEffect, useState } from "react";

import type { SessionSection } from "./SessionWorkspace";
import type { InspectorTab } from "./use-workspace-view-model";
import type { SettingsSection } from "./WorkspaceSettingsSurface";
import type { WorkspaceView } from "./WorkspaceViewNavigation";

const SESSION_TAB: Partial<Record<InspectorTab, SessionSection>> = {
  plan: "plan",
  studio: "studio",
  goal: "goal",
  files: "files",
  browser: "browser",
  processes: "processes",
  lab: "lab",
  automations: "automations",
};
const SETTINGS_TAB: Partial<Record<InspectorTab, SettingsSection>> = {
  context: "context",
  memory: "memory",
  extensions: "extensions",
};

// Sections that map onto a legacy InspectorTab (deep-link / roving focus).
// "workspace" and "language" are settings-only surfaces with no InspectorTab.
function inspectorTabForSection(
  section: SettingsSection,
): InspectorTab | undefined {
  return section === "context" ||
    section === "memory" ||
    section === "extensions"
    ? section
    : undefined;
}

export function useWorkspaceShell(
  setInspectorTab: (tab: InspectorTab) => void,
) {
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("conversation");
  const [sessionSection, setSessionSectionState] =
    useState<SessionSection>("plan");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSectionState] =
    useState<SettingsSection>("context");

  const routeInspector = useCallback(
    (tab: InspectorTab) => {
      setInspectorTab(tab);
      if (tab === "trace") {
        setWorkspaceView("trace");
        setSettingsOpen(false);
        return;
      }
      const session = SESSION_TAB[tab];
      if (session) {
        setSessionSectionState(session);
        setWorkspaceView("session");
        setSettingsOpen(false);
        return;
      }
      const settings = SETTINGS_TAB[tab];
      if (settings) {
        setSettingsSectionState(settings);
        setSettingsOpen(true);
      }
    },
    [setInspectorTab],
  );
  const openSettings = useCallback(() => {
    const tab = inspectorTabForSection(settingsSection);
    if (tab) setInspectorTab(tab);
    setSettingsOpen(true);
  }, [setInspectorTab, settingsSection]);
  const setSessionSection = useCallback(
    (section: SessionSection) => {
      setSessionSectionState(section);
      setInspectorTab(section);
    },
    [setInspectorTab],
  );
  const setSettingsSection = useCallback(
    (section: SettingsSection) => {
      setSettingsSectionState(section);
      const tab = inspectorTabForSection(section);
      if (tab) setInspectorTab(tab);
    },
    [setInspectorTab],
  );
  const openWorkspaceSettings = useCallback(() => {
    setSettingsSectionState("workspace");
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key === "," &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [openSettings]);

  return {
    workspaceView,
    setWorkspaceView,
    sessionSection,
    setSessionSection,
    settingsOpen,
    settingsSection,
    setSettingsSection,
    closeSettings,
    routeInspector,
    openSettings,
    openWorkspaceSettings,
  };
}
