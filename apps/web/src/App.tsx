import { FatalState, LoadingShell } from "./AppInitialStates";
import { AppLedgerNavigation } from "./AppLedgerNavigation";
import { AppSettingsOverlay } from "./AppSettingsOverlay";
import { AppWorkbenchHeader } from "./AppWorkbenchHeader";
import { AppWorkspaceViews } from "./AppWorkspaceViews";
import { composerCanStartRun } from "./composer-run-availability";
import { copy } from "./copy";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import { useWorkspaceShell } from "./use-workspace-shell";
import { useWorkspaceViewModel } from "./use-workspace-view-model";

export function App() {
  const vm = useWorkspaceViewModel(),
    shell = useWorkspaceShell(vm.setInspectorTab);
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
    <div className="app-shell" data-workspace-view={shell.workspaceView}>
      <AppLedgerNavigation vm={vm} shell={shell} />
      <main className="workbench">
        <AppWorkbenchHeader
          vm={vm}
          shell={shell}
          browserControlsAvailable={taskControls.browserControlsAvailable}
          onOpenBrowserControls={taskControls.openBrowserControls}
          onStop={() => void vm.stop()}
        />
        <AppWorkspaceViews
          vm={vm}
          bootstrap={vm.bootstrap}
          shell={shell}
          taskControls={taskControls}
          activeAgent={activeAgent}
          activeModel={activeModel}
          canStartRun={canStartRun}
        />
      </main>
      <AppSettingsOverlay vm={vm} shell={shell} activeAgent={activeAgent} />
    </div>
  );
}
