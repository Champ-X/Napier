import { lazy, Suspense, useRef } from "react";
import { FatalState, LoadingShell } from "./AppInitialStates";
import { AppLedgerNavigation } from "./AppLedgerNavigation";
import { AppWorkbenchHeader } from "./AppWorkbenchHeader";
import { composerCanStartRun } from "./composer-run-availability";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { copy } from "./copy";
import { TaskNarrativeBoundary } from "./TaskNarrativeBoundary";
import { useConversationAutoScroll } from "./use-conversation-auto-scroll";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import { useWorkspaceShell } from "./use-workspace-shell";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
} from "./WorkbenchDeferredPanels";

const LazyTaskWorkspace = lazy(() =>
  import("./TaskWorkspace").then(({ TaskWorkspace }) => ({
    default: TaskWorkspace,
  })),
);
const LazyTraceWorkspace = lazy(() =>
  import("./TraceWorkspace").then(({ TraceWorkspace }) => ({
    default: TraceWorkspace,
  })),
);
const LazyWorkspaceSettingsSurface = lazy(() =>
  import("./WorkspaceSettingsSurface").then(({ WorkspaceSettingsSurface }) => ({
    default: WorkspaceSettingsSurface,
  })),
);
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
        <AppWorkbenchHeader vm={vm} shell={shell} />
        <div className="workspace-primary-surface">
          {shell.workspaceView === "conversation" ? (
            <section
              id="workspace-panel-conversation"
              className="workspace-view-panel conversation-workspace-view"
              role="tabpanel"
              aria-labelledby="workspace-view-conversation"
            >
              <TaskNarrativeBoundary
                detail={vm.detail}
                browserControlsAvailable={taskControls.browserControlsAvailable}
                onOpenArtifact={taskControls.openArtifact}
                onOpenBrowserControls={taskControls.openBrowserControls}
                onStop={() => void vm.stop()}
              />
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
            <Suspense fallback={null}>
              <LazyTraceWorkspace vm={vm} activeModel={activeModel} />
            </Suspense>
          ) : null}
          {shell.workspaceView === "task" ? (
            <section
              id="workspace-panel-task"
              className="workspace-view-panel task-workspace-view"
              role="tabpanel"
              aria-labelledby="workspace-view-task"
            >
              <Suspense fallback={null}>
                <LazyTaskWorkspace
                  vm={vm}
                  section={shell.taskSection}
                  activeModel={activeModel}
                  onSection={shell.setTaskSection}
                  onOpenConversation={() =>
                    shell.setWorkspaceView("conversation")
                  }
                />
              </Suspense>
            </section>
          ) : null}
        </div>
      </main>
      {shell.settingsOpen ? (
        <Suspense fallback={null}>
          <LazyWorkspaceSettingsSurface
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
        </Suspense>
      ) : null}
    </div>
  );
}
