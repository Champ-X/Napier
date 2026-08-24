import { useRef } from "react";
import { FatalState, LoadingShell } from "./AppInitialStates";
import { AppLedgerNavigation } from "./AppLedgerNavigation";
import { AppWorkbenchHeader } from "./AppWorkbenchHeader";
import { composerCanStartRun } from "./composer-run-availability";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { copy } from "./copy";
import { TaskWorkspace } from "./TaskWorkspace";
import { TraceWorkspace } from "./TraceWorkspace";
import { useConversationAutoScroll } from "./use-conversation-auto-scroll";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import { useWorkspaceShell } from "./use-workspace-shell";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
} from "./WorkbenchDeferredPanels";
import { WorkspaceSettingsSurface } from "./WorkspaceSettingsSurface";
export function App() {
  const vm = useWorkspaceViewModel(),
    conversationEnd = useRef<HTMLDivElement>(null),
    conversationViewport = useRef<HTMLElement>(null),
    shell = useWorkspaceShell(vm.setInspectorTab);
  useConversationAutoScroll({
    endRef: conversationEnd,
    viewportRef: conversationViewport,
    messageCount: vm.messages.length,
    streamingText: vm.streamingText,
    running: vm.isRunning,
    view: shell.workspaceView,
  });
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
          onOpenArtifact={taskControls.openArtifact}
          onOpenBrowserControls={taskControls.openBrowserControls}
          onStop={() => void vm.stop()}
        />
        <div className="workspace-primary-surface">
          {shell.workspaceView === "conversation" ? (
            <section
              id="workspace-panel-conversation"
              className="workspace-view-panel conversation-workspace-view"
              role="tabpanel"
              aria-labelledby="workspace-view-conversation"
            >
              <WorkbenchDeferredNotices vm={vm} />
              <ConversationWorkspace
                vm={vm}
                endRef={conversationEnd}
                viewportRef={conversationViewport}
              />
              <WorkbenchDeferredDecisions
                vm={vm}
                browserControlsAvailable={taskControls.browserControlsAvailable}
              />
              <Composer
                vm={vm}
                activeAgent={activeAgent}
                activeModel={activeModel}
                canStartRun={canStartRun}
                workspaceRoot={vm.bootstrap.workspace.root}
                onOpenInspector={shell.routeInspector}
                onOpenWorkspace={shell.openWorkspaceSettings}
                onWorkspaceSwitch={vm.switchWorkspaceRoot}
              />
            </section>
          ) : null}
          {shell.workspaceView === "trajectory" ? (
            <TraceWorkspace vm={vm} activeModel={activeModel} />
          ) : null}
          {shell.workspaceView === "task" ? (
            <section
              id="workspace-panel-task"
              className="workspace-view-panel task-workspace-view"
              role="tabpanel"
              aria-labelledby="workspace-view-task"
            >
              <TaskWorkspace
                vm={vm}
                section={shell.taskSection}
                activeModel={activeModel}
                onSection={shell.setTaskSection}
              />
            </section>
          ) : null}
        </div>
      </main>
      {shell.settingsOpen ? (
        <WorkspaceSettingsSurface
          vm={vm}
          activeAgent={activeAgent}
          section={shell.settingsSection}
          onSection={shell.setSettingsSection}
          onClose={shell.closeSettings}
          onWorkspaceSwitch={vm.switchWorkspaceRoot}
          onConversation={() => {
            shell.closeSettings();
            shell.setWorkspaceView("conversation");
          }}
        />
      ) : null}
    </div>
  );
}
