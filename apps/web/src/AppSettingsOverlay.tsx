import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  WorkspaceSettingsSurface,
  type WorkspaceSettingsSurfaceProps,
} from "./WorkspaceSettingsSurface";

export function AppSettingsOverlay({
  vm,
  shell,
  activeAgent,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
  activeAgent: WorkspaceSettingsSurfaceProps["activeAgent"];
}) {
  if (!shell.settingsOpen) return null;
  return (
    <WorkspaceSettingsSurface
      vm={vm}
      activeAgent={activeAgent}
      section={shell.settingsSection}
      onSection={shell.setSettingsSection}
      onClose={shell.closeSettings}
      onWorkspaceSwitch={vm.switchWorkspaceRoot}
    />
  );
}
