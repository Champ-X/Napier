import { WorkbenchHeader } from "./WorkbenchHeader";
import {
  workspaceViews,
  WorkspaceViewNavigation,
} from "./WorkspaceViewNavigation";
import { TaskNarrativeBoundary } from "./TaskNarrativeBoundary";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import { recentModelKeysFromRuns } from "./model-selection-view-model";

export function AppWorkbenchHeader({
  vm,
  shell,
  browserControlsAvailable,
  onOpenBrowserControls,
}: {
  vm: ReturnType<typeof useWorkspaceViewModel>;
  shell: ReturnType<typeof useWorkspaceShell>;
  browserControlsAvailable: boolean;
  onOpenBrowserControls(): void;
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
      recommendedModelKeys={
        vm.detail?.agent
          ? [`${vm.detail.agent.model.provider}/${vm.detail.agent.model.id}`]
          : []
      }
      recentModelKeys={recentModelKeysFromRuns(vm.detail?.runs ?? [])}
      onOpenDeveloperWorkbench={shell.openDeveloperWorkbench}
      onOpenSettings={shell.openSettings}
      taskStatus={
        <TaskNarrativeBoundary
          detail={vm.detail}
          browserControlsAvailable={browserControlsAvailable}
          onOpenBrowserControls={onOpenBrowserControls}
        />
      }
    >
      <WorkspaceViewNavigation
        activeView={shell.workspaceView}
        eventCount={vm.visibleTrace.length}
        runCount={vm.detail?.runs.length ?? 0}
        subagentCount={vm.detail?.subagentHub?.taskCount ?? vm.detail?.subagents.length ?? 0}
        onChange={shell.setWorkspaceView}
      />
    </WorkbenchHeader>
  );
}
