import { WorkbenchHeader } from "./WorkbenchHeader";
import {
  workspaceViews,
  WorkspaceViewNavigation,
} from "./WorkspaceViewNavigation";
import { TaskNarrativeBoundary } from "./TaskNarrativeBoundary";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

export function AppWorkbenchHeader({
  vm,
  shell,
  browserControlsAvailable,
  onOpenArtifact,
  onOpenBrowserControls,
  onStop,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
  browserControlsAvailable: boolean;
  onOpenArtifact(path: string): void;
  onOpenBrowserControls(): void;
  onStop(): void;
}) {
  if (!vm.bootstrap) return null;
  return (
    <WorkbenchHeader
      isRunning={vm.isRunning}
      model={vm.selectedModel}
      models={vm.bootstrap.models}
      status={vm.detail?.thread.status}
      title={vm.detail?.thread.title ?? ""}
      contextLabel={
        workspaceViews.find((view) => view.id === shell.workspaceView)?.label ??
        ""
      }
      onModel={vm.setSelectedModelKey}
      onOpenSettings={shell.openSettings}
      taskStatus={
        <TaskNarrativeBoundary
          detail={vm.detail}
          browserControlsAvailable={browserControlsAvailable}
          onOpenArtifact={onOpenArtifact}
          onOpenBrowserControls={onOpenBrowserControls}
          onStop={onStop}
        />
      }
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
