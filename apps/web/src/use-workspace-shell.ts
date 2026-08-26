import { useCallback, useEffect, useState } from "react";

import type { TaskSection } from "./TaskWorkspace";
import type { DeveloperWorkbenchSection } from "./developer-workbench-section-registry";
import type { InspectorTab } from "./use-workspace-view-model";
import type { SettingsSection } from "./WorkspaceSettingsSurface";
import type { WorkspaceView } from "./WorkspaceViewNavigation";

const TASK_TAB: Partial<Record<InspectorTab, TaskSection>> = {
  plan: "overview",
  goal: "overview",
  files: "changes",
  browser: "environment",
  processes: "environment",
};
const SETTINGS_TAB: Partial<Record<InspectorTab, SettingsSection>> = {
  context: "context",
  memory: "memory",
  extensions: "extensions",
};
const DEVELOPER_TAB: Partial<Record<InspectorTab, DeveloperWorkbenchSection>> = {
  automations: "automations",
  studio: "lab",
  lab: "lab",
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

function inspectorTabForDeveloperSection(
  section: DeveloperWorkbenchSection,
): InspectorTab | undefined {
  return section === "automations"
    ? "automations"
    : section === "lab"
      ? "lab"
      : undefined;
}

export function useWorkspaceShell(
  setInspectorTab: (tab: InspectorTab) => void,
) {
  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("conversation");
  const [taskSection, setTaskSectionState] =
    useState<TaskSection>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSectionState] =
    useState<SettingsSection>("context");
  const [developerWorkbenchOpen, setDeveloperWorkbenchOpen] = useState(false);
  const [developerWorkbenchSection, setDeveloperWorkbenchSectionState] =
    useState<DeveloperWorkbenchSection>("lab");

  const routeInspector = useCallback(
    (tab: InspectorTab) => {
      setInspectorTab(tab);
      if (tab === "trace") {
        setWorkspaceView("trajectory");
        setSettingsOpen(false);
        setDeveloperWorkbenchOpen(false);
        return;
      }
      const task = TASK_TAB[tab];
      if (task) {
        setTaskSectionState(task);
        setWorkspaceView("task");
        setSettingsOpen(false);
        setDeveloperWorkbenchOpen(false);
        return;
      }
      const settings = SETTINGS_TAB[tab];
      if (settings) {
        setSettingsSectionState(settings);
        setSettingsOpen(true);
        setDeveloperWorkbenchOpen(false);
        return;
      }
      const developer = DEVELOPER_TAB[tab];
      if (developer) {
        setDeveloperWorkbenchSectionState(developer);
        setDeveloperWorkbenchOpen(true);
        setSettingsOpen(false);
      }
    },
    [setInspectorTab],
  );
  const openSettings = useCallback(() => {
    const tab = inspectorTabForSection(settingsSection);
    if (tab) setInspectorTab(tab);
    setSettingsOpen(true);
    setDeveloperWorkbenchOpen(false);
  }, [setInspectorTab, settingsSection]);
  const openDeveloperWorkbench = useCallback(() => {
    const tab = inspectorTabForDeveloperSection(developerWorkbenchSection);
    if (tab) setInspectorTab(tab);
    setDeveloperWorkbenchOpen(true);
    setSettingsOpen(false);
  }, [developerWorkbenchSection, setInspectorTab]);
  const setTaskSection = useCallback(
    (section: TaskSection) => {
      setTaskSectionState(section);
      const inspectorTab: InspectorTab =
        section === "overview"
          ? "plan"
          : section === "changes"
            ? "files"
            : section === "environment"
              ? "browser"
              : "plan";
      setInspectorTab(inspectorTab);
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
    setDeveloperWorkbenchOpen(false);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const setDeveloperWorkbenchSection = useCallback(
    (section: DeveloperWorkbenchSection) => {
      setDeveloperWorkbenchSectionState(section);
      const tab = inspectorTabForDeveloperSection(section);
      if (tab) setInspectorTab(tab);
    },
    [setInspectorTab],
  );
  const closeDeveloperWorkbench = useCallback(
    () => setDeveloperWorkbenchOpen(false),
    [],
  );

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
    taskSection,
    setTaskSection,
    settingsOpen,
    settingsSection,
    setSettingsSection,
    closeSettings,
    developerWorkbenchOpen,
    developerWorkbenchSection,
    setDeveloperWorkbenchSection,
    openDeveloperWorkbench,
    closeDeveloperWorkbench,
    routeInspector,
    openSettings,
    openWorkspaceSettings,
  };
}
