import { WorkbenchHeader } from "./WorkbenchHeader";
import { WorkspaceViewNavigation } from "./WorkspaceViewNavigation";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

export function AppWorkbenchHeader({
  vm,
  shell,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
}) {
  if (!vm.bootstrap) return null;
  return (
    <WorkbenchHeader
      isRunning={vm.isRunning}
      model={vm.selectedModel}
      models={vm.bootstrap.models}
      status={vm.detail?.thread.status}
      title={vm.detail?.thread.title ?? ""}
      onModel={vm.setSelectedModelKey}
      onOpenSettings={shell.openSettings}
    >
      <WorkspaceViewNavigation
        activeView={shell.workspaceView}
        eventCount={vm.visibleTrace.length}
        runCount={vm.detail?.runs.length ?? 0}
        onChange={shell.setWorkspaceView}
      />
    </WorkbenchHeader>
  );
}
