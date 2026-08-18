import { useRef } from "react";

import { FatalState, LoadingShell } from "./AppInitialStates";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { copy } from "./copy";
import { LedgerNavigation } from "./LedgerNavigation";
import { SessionWorkspace } from "./SessionWorkspace";
import { TaskNarrativeBoundary } from "./TaskNarrativeBoundary";
import { TraceWorkspace } from "./TraceWorkspace";
import { useConversationAutoScroll } from "./use-conversation-auto-scroll";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import { useWorkspaceShell } from "./use-workspace-shell";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
} from "./WorkbenchDeferredPanels";
import { WorkbenchHeader } from "./WorkbenchHeader";
import { WorkspaceSettingsSurface } from "./WorkspaceSettingsSurface";
import { WorkspaceViewNavigation } from "./WorkspaceViewNavigation";

export function App() {
  const vm = useWorkspaceViewModel();
  const conversationEnd = useRef<HTMLDivElement>(null);
  const shell = useWorkspaceShell(vm.setInspectorTab);
  useConversationAutoScroll({
    endRef: conversationEnd,
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

  const activeAgent = vm.detail?.agent ?? vm.bootstrap.agents[0];
  const activeModel = vm.selectedModel;
  const canStartRun = Boolean(
    vm.composer.trim() &&
    vm.detail &&
    !vm.openOperatorDecision &&
    activeModel.configured,
  );
  return (
    <div className="app-shell" data-workspace-view={shell.workspaceView}>
      <LedgerNavigation
        bootstrap={vm.bootstrap}
        selectedThreadId={vm.selectedThreadId}
        busyThreadId={vm.threadLifecycleBusyId}
        trashedThread={vm.trashedThreadReceipt}
        onNewThread={() => void vm.newThread()}
        onSelect={(threadId) => void vm.selectThread(threadId)}
        onTrash={(threadId) => void vm.trashThread(threadId)}
        onRestore={() => void vm.restoreTrashedThread()}
        onOpenSettings={shell.openSettings}
      />
      <main className="workbench">
        <WorkbenchHeader
          isRunning={vm.isRunning}
          model={activeModel}
          status={vm.detail?.thread.status}
          title={vm.detail?.thread.title ?? ""}
          onOpenSettings={shell.openSettings}
        >
          <WorkspaceViewNavigation
            activeView={shell.workspaceView}
            eventCount={vm.detail?.events.length ?? 0}
            runCount={vm.detail?.runs.length ?? 0}
            onChange={shell.setWorkspaceView}
          />
        </WorkbenchHeader>
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
              <ConversationWorkspace vm={vm} endRef={conversationEnd} />
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
              />
            </section>
          ) : null}
          {shell.workspaceView === "trace" ? (
            <TraceWorkspace vm={vm} activeModel={activeModel} />
          ) : null}
          {shell.workspaceView === "session" ? (
            <section
              id="workspace-panel-session"
              className="workspace-view-panel session-workspace-view"
              role="tabpanel"
              aria-labelledby="workspace-view-session"
            >
              <SessionWorkspace
                vm={vm}
                section={shell.sessionSection}
                activeModel={activeModel}
                onSection={shell.setSessionSection}
                onConversation={() => shell.setWorkspaceView("conversation")}
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
        />
      ) : null}
    </div>
  );
}
