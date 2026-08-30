import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { AgentProfile, BootstrapResponse } from "@napier/contracts";
import { Composer } from "./Composer";
import { ArtifactInspector } from "./ArtifactInspector";
import { WorkbenchBrowserRail } from "./WorkbenchBrowserRail";
import type { ArtifactInspection } from "./artifact-inspection";
import {
  ConversationWorkspace,
  shouldShowConversationWelcome,
} from "./ConversationWorkspace";
import type { useTaskControlNavigation } from "./use-task-control-navigation";
import type { useWorkspaceShell } from "./use-workspace-shell";
import {
  WORKSPACE_EVIDENCE_WIDTH,
  type WorkspaceLayoutControls,
} from "./use-workspace-layout";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";
import {
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
  WorkbenchDeferredTaskResult,
} from "./WorkbenchDeferredPanels";
import { WelcomeStarterPrompts } from "./WelcomePanel";

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
  layout: WorkspaceLayoutControls;
}

export function AppWorkspaceViews({
  vm,
  bootstrap,
  shell,
  taskControls,
  activeAgent,
  activeModel,
  canStartRun,
  layout,
}: AppWorkspaceViewsProps) {
  const conversationEnd = useRef<HTMLDivElement>(null);
  const conversationViewport = useRef<HTMLElement>(null);
  const [artifactInspection, setArtifactInspection] =
    useState<ArtifactInspection>();
  const showBrowserRail =
    shell.workspaceView === "conversation" &&
    !artifactInspection &&
    taskControls.browserControlsAvailable;
  const showEvidenceRail = Boolean(artifactInspection) || showBrowserRail;
  const showConversationWelcome = shouldShowConversationWelcome(
    vm.messages,
    vm.detail?.events.length ?? 0,
  );
  useEffect(
    () => setArtifactInspection(undefined),
    [vm.detail?.thread.id, shell.workspaceView],
  );

  return (
    <div
      className={`workspace-primary-surface${artifactInspection ? " has-artifact-inspector" : ""}${showBrowserRail ? " has-browser-rail" : ""}`}
    >
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
            onInspectArtifact={setArtifactInspection}
          />
          <WorkbenchDeferredTaskResult
            vm={vm}
            onOpenArtifact={taskControls.openArtifact}
          />
          <WorkbenchDeferredDecisions vm={vm} />
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
          {showConversationWelcome ? (
            <WelcomeStarterPrompts
              onSelect={(prompt) => {
                vm.setComposer(prompt);
                document
                  .querySelector<HTMLTextAreaElement>(
                    "#workspace-panel-conversation .composer textarea",
                  )
                  ?.focus();
              }}
            />
          ) : null}
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
      {showEvidenceRail ? (
        <WorkspaceResizeHandle
          side="evidence"
          label="调整预览栏宽度"
          value={layout.evidenceWidth}
          min={WORKSPACE_EVIDENCE_WIDTH.min}
          max={layout.evidenceMax}
          onChange={layout.setEvidenceWidth}
          onReset={layout.resetEvidenceWidth}
        />
      ) : null}
      {shell.workspaceView === "conversation" && artifactInspection ? (
        <ArtifactInspector
          inspection={artifactInspection}
          onLedgerChanged={vm.refreshActiveThread}
          onClose={() => setArtifactInspection(undefined)}
        />
      ) : null}
      {showBrowserRail && vm.activeRunId && vm.detail ? (
        <WorkbenchBrowserRail
          threadId={vm.detail.thread.id}
          runId={vm.activeRunId}
          events={vm.detail.events}
          {...(vm.browserInteractionConfirmation
            ? { confirmationAction: vm.browserInteractionConfirmation.action }
            : {})}
        />
      ) : null}
    </div>
  );
}
