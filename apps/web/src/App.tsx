import type { CSSProperties } from "react";

import { FatalState, LoadingShell } from "./AppInitialStates";
import { AppDeveloperWorkbenchOverlay } from "./AppDeveloperWorkbenchOverlay";
import { AppLedgerNavigation } from "./AppLedgerNavigation";
import { AppSettingsOverlay } from "./AppSettingsOverlay";
import { AppWorkbenchHeader } from "./AppWorkbenchHeader";
import { AppWorkspaceViews } from "./AppWorkspaceViews";
import { ThreadUndoToast } from "./ThreadUndoToast";
import { composerCanStartRun } from "./composer-run-availability";
import { copy } from "./copy";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import {
  WORKSPACE_NAVIGATION_WIDTH,
  useWorkspaceLayout,
} from "./use-workspace-layout";
import { useWorkspaceShell } from "./use-workspace-shell";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";

export function App() {
  const vm = useWorkspaceViewModel(),
    shell = useWorkspaceShell(vm.setInspectorTab),
    layout = useWorkspaceLayout();
  const taskControls = useTaskControlNavigation({
    activeRunId: vm.activeRunId,
    events: vm.detail?.events ?? [],
    onSelectInspector: shell.routeInspector,
  });
  if (vm.isLoading) return <LoadingShell />;
  if (!vm.bootstrap) {
    return <FatalState message={vm.error ?? copy.notices.disconnected} />;
  }
  const activeAgent = vm.detail?.agent ?? vm.bootstrap.agents[0],
    activeModel = vm.selectedModel;
  const canStartRun = composerCanStartRun({
    text: vm.composer,
    hasThread: Boolean(vm.detail),
    hasOpenDecision: Boolean(vm.openOperatorDecision),
    model: activeModel,
  });
  return (
    <div
      className="app-shell"
      data-workspace-view={shell.workspaceView}
      style={
        {
          "--workspace-navigation-width": `${layout.navigationWidth}px`,
          "--workspace-evidence-width": `${layout.evidenceWidth}px`,
        } as CSSProperties
      }
    >
      <AppLedgerNavigation vm={vm} shell={shell} layout={layout} />
      {!layout.collapsed ? (
        <WorkspaceResizeHandle
          side="navigation"
          label="调整会话导航宽度"
          value={layout.navigationWidth}
          min={WORKSPACE_NAVIGATION_WIDTH.min}
          max={layout.navigationMax}
          onChange={layout.setNavigationWidth}
          onReset={layout.resetNavigationWidth}
        />
      ) : null}
      <ThreadUndoToast
        title={vm.trashedThreadReceipt?.title}
        busy={vm.threadLifecycleBusyId === vm.trashedThreadReceipt?.threadId}
        labels={copy.trash}
        onRestore={() => void vm.restoreTrashedThread()}
      />
      <main className="workbench">
        <AppWorkbenchHeader
          vm={vm}
          shell={shell}
          browserControlsAvailable={taskControls.browserControlsAvailable}
          onOpenBrowserControls={taskControls.openBrowserControls}
        />
        <AppWorkspaceViews
          vm={vm}
          bootstrap={vm.bootstrap}
          shell={shell}
          taskControls={taskControls}
          activeAgent={activeAgent}
          activeModel={activeModel}
          canStartRun={canStartRun}
          layout={layout}
        />
      </main>
      <AppSettingsOverlay vm={vm} shell={shell} activeAgent={activeAgent} />
      <AppDeveloperWorkbenchOverlay
        vm={vm}
        shell={shell}
        activeAgent={activeAgent}
      />
    </div>
  );
}
