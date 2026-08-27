import { lazy, Suspense, useRef } from "react";

import type { AgentProfile, BootstrapResponse } from "@napier/contracts";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import type { useTaskControlNavigation } from "./use-task-control-navigation";
import type { useWorkspaceShell } from "./use-workspace-shell";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import {
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
  WorkbenchDeferredTaskResult,
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
const LazySubagentHubWorkspace = lazy(() =>
  import("./SubagentHubWorkspace").then(({ SubagentHubWorkspace }) => ({
    default: SubagentHubWorkspace,
  })),
);

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export interface AppWorkspaceViewsProps {
  vm: WorkspaceViewModel;
  bootstrap: BootstrapResponse;
  shell: ReturnType<typeof useWorkspaceShell>;
  taskControls: ReturnType<typeof useTaskControlNavigation>;
  activeAgent: AgentProfile | undefined;
  activeModel: WorkspaceViewModel["selectedModel"];
  canStartRun: boolean;
}

export function AppWorkspaceViews({
  vm,
  bootstrap,
  shell,
  taskControls,
  activeAgent,
  activeModel,
  canStartRun,
}: AppWorkspaceViewsProps) {
  const conversationEnd = useRef<HTMLDivElement>(null);
  const conversationViewport = useRef<HTMLElement>(null);

  return (
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
            onOpenSubagentHub={shell.openSubagentHub}
          />
          <WorkbenchDeferredTaskResult
            vm={vm}
            onOpenArtifact={taskControls.openArtifact}
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
            workspaceRoot={bootstrap.workspace.root}
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
      {shell.workspaceView === "subagents" ? (
        <Suspense fallback={null}>
          <LazySubagentHubWorkspace
            vm={vm}
            {...(shell.focusedSubagentTaskId
              ? { focusedTaskId: shell.focusedSubagentTaskId }
              : {})}
          />
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
              onOpenConversation={() => shell.setWorkspaceView("conversation")}
            />
          </Suspense>
        </section>
      ) : null}
    </div>
  );
}
