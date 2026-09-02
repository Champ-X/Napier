import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { AgentProfile, BootstrapResponse } from "@napier/contracts";
import { Composer } from "./Composer";
import { ArtifactInspector } from "./ArtifactInspector";
import { WorkbenchBrowserRail } from "./WorkbenchBrowserRail";
import { WorkspaceEvidenceRail } from "./WorkspaceEvidenceRail";
import { WorkspaceFileInspector } from "./WorkspaceFileInspector";
import { SkillResourceInspector } from "./SkillResourceInspector";
import { workspaceEvidenceCopy as workspaceCopy } from "./workspace-evidence-copy";
import type { ArtifactInspection } from "./artifact-inspection";
import type { MessageSkillResourceLink } from "./message-markdown";
import { taskArtifactTargets } from "./task-completion-output-paths";
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
  WorkbenchDeferredCompactTaskResult,
  WorkbenchDeferredDecisions,
  WorkbenchDeferredNotices,
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
  const [workspaceFilePath, setWorkspaceFilePath] = useState<string>();
  const [skillResourceInspection, setSkillResourceInspection] =
    useState<MessageSkillResourceLink>();
  const [dismissedBrowserRunId, setDismissedBrowserRunId] = useState<string>();
  const inspectionOpen = Boolean(
    artifactInspection || workspaceFilePath || skillResourceInspection,
  );
  const showBrowserRail =
    shell.workspaceView === "conversation" &&
    !inspectionOpen &&
    taskControls.browserControlsAvailable &&
    dismissedBrowserRunId !== vm.activeRunId;
  const showWorkspaceRail =
    shell.workspaceView === "conversation" &&
    !inspectionOpen &&
    !showBrowserRail &&
    shell.workspaceRailOpen;
  const showConversationWelcome = shouldShowConversationWelcome(
    vm.messages,
    vm.detail?.events.length ?? 0,
  );
  useEffect(() => {
    setArtifactInspection(undefined);
    setWorkspaceFilePath(undefined);
    setSkillResourceInspection(undefined);
  }, [vm.detail?.thread.id, shell.workspaceView]);
  const openArtifact = useCallback(
    (path: string) => {
      setSkillResourceInspection(undefined);
      const inspection = artifactInspectionForPath(
        vm.detail,
        bootstrap.workspace.root,
        path,
      );
      if (inspection) {
        setWorkspaceFilePath(undefined);
        setArtifactInspection(inspection);
        return;
      }
      setArtifactInspection(undefined);
      setWorkspaceFilePath(
        absoluteWorkspacePath(bootstrap.workspace.root, path),
      );
    },
    [bootstrap.workspace.root, vm.detail],
  );
  const inspectArtifact = useCallback((inspection: ArtifactInspection) => {
    setWorkspaceFilePath(undefined);
    setSkillResourceInspection(undefined);
    setArtifactInspection(inspection);
  }, []);
  const inspectSkillResource = useCallback(
    (reference: MessageSkillResourceLink) => {
      setArtifactInspection(undefined);
      setWorkspaceFilePath(undefined);
      setSkillResourceInspection(reference);
    },
    [],
  );
  const closeWorkspaceRail = useCallback(() => {
    shell.setWorkspaceRailOpen(false);
    requestAnimationFrame(() =>
      document.getElementById("workspace-rail-toggle")?.focus(),
    );
  }, [shell.setWorkspaceRailOpen]);
  const closeArtifact = useCallback(() => setArtifactInspection(undefined), []);
  const closeWorkspaceFile = useCallback(
    () => setWorkspaceFilePath(undefined),
    [],
  );
  const closeSkillResource = useCallback(
    () => setSkillResourceInspection(undefined),
    [],
  );
  const closeBrowser = useCallback(
    () => setDismissedBrowserRunId(vm.activeRunId),
    [vm.activeRunId],
  );
  const evidenceOverlay =
    !layout.workspaceRailAvailable &&
    (inspectionOpen || showBrowserRail || showWorkspaceRail);

  return (
    <div
      className={`workspace-primary-surface${inspectionOpen ? " has-artifact-inspector" : ""}${showBrowserRail ? " has-browser-rail" : ""}${showWorkspaceRail ? " has-workspace-rail" : ""}${evidenceOverlay ? " has-evidence-overlay" : ""}`}
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
            onInspectArtifact={inspectArtifact}
            onOpenWorkspaceFile={openArtifact}
            onOpenSkillResource={inspectSkillResource}
          />
          <WorkbenchDeferredCompactTaskResult
            vm={vm}
            onOpenArtifact={openArtifact}
            suppressed={showWorkspaceRail}
          />
          <WorkbenchDeferredDecisions vm={vm} />
          <Composer
            vm={vm}
            activeAgent={activeAgent}
            activeModel={activeModel}
            canStartRun={canStartRun}
            onOpenInspector={shell.routeInspector}
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
      <AppWorkspaceEvidenceSurfaces
        vm={vm}
        bootstrap={bootstrap}
        layout={layout}
        artifactInspection={artifactInspection}
        workspaceFilePath={workspaceFilePath}
        skillResourceInspection={skillResourceInspection}
        showBrowserRail={showBrowserRail}
        showWorkspaceRail={showWorkspaceRail}
        onOpenArtifact={openArtifact}
        onCloseArtifact={closeArtifact}
        onCloseWorkspaceFile={closeWorkspaceFile}
        onCloseSkillResource={closeSkillResource}
        onCloseBrowser={closeBrowser}
        onCloseWorkspaceRail={closeWorkspaceRail}
      />
    </div>
  );
}

interface AppWorkspaceEvidenceSurfacesProps {
  vm: WorkspaceViewModel;
  bootstrap: BootstrapResponse;
  layout: WorkspaceLayoutControls;
  artifactInspection: ArtifactInspection | undefined;
  workspaceFilePath: string | undefined;
  skillResourceInspection: MessageSkillResourceLink | undefined;
  showBrowserRail: boolean;
  showWorkspaceRail: boolean;
  onOpenArtifact(path: string): void;
  onCloseArtifact(): void;
  onCloseWorkspaceFile(): void;
  onCloseSkillResource(): void;
  onCloseBrowser(): void;
  onCloseWorkspaceRail(): void;
}

function AppWorkspaceEvidenceSurfaces({
  vm,
  bootstrap,
  layout,
  artifactInspection,
  workspaceFilePath,
  skillResourceInspection,
  showBrowserRail,
  showWorkspaceRail,
  onOpenArtifact,
  onCloseArtifact,
  onCloseWorkspaceFile,
  onCloseSkillResource,
  onCloseBrowser,
  onCloseWorkspaceRail,
}: AppWorkspaceEvidenceSurfacesProps) {
  const showResizableRail =
    layout.workspaceRailAvailable &&
    (Boolean(artifactInspection) ||
      Boolean(workspaceFilePath) ||
      Boolean(skillResourceInspection) ||
      showBrowserRail);

  return (
    <>
      {showResizableRail ? (
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
      {artifactInspection ? (
        <ArtifactInspector
          inspection={artifactInspection}
          onLedgerChanged={vm.refreshActiveThread}
          onClose={onCloseArtifact}
        />
      ) : null}
      {workspaceFilePath ? (
        <WorkspaceFileInspector
          path={workspaceFilePath}
          onClose={onCloseWorkspaceFile}
        />
      ) : null}
      {skillResourceInspection ? (
        <SkillResourceInspector
          reference={skillResourceInspection}
          onClose={onCloseSkillResource}
        />
      ) : null}
      {showBrowserRail && vm.activeRunId && vm.detail ? (
        <>
          {!layout.workspaceRailAvailable ? (
            <button
              type="button"
              className="workspace-evidence-backdrop is-browser"
              tabIndex={-1}
              aria-label={workspaceCopy.hideBrowser}
              onClick={onCloseBrowser}
            />
          ) : null}
          <WorkbenchBrowserRail
            threadId={vm.detail.thread.id}
            runId={vm.activeRunId}
            events={vm.detail.events}
            onClose={onCloseBrowser}
            {...(vm.browserInteractionConfirmation
              ? { confirmationAction: vm.browserInteractionConfirmation.action }
              : {})}
          />
        </>
      ) : null}
      {showWorkspaceRail && !layout.workspaceRailAvailable ? (
        <button
          type="button"
          className="workspace-evidence-backdrop"
          tabIndex={-1}
          aria-label={workspaceCopy.hideRail}
          onClick={onCloseWorkspaceRail}
        />
      ) : null}
      <WorkspaceEvidenceRail
        workspace={bootstrap.workspace}
        detail={vm.detail}
        open={showWorkspaceRail}
        overlay={!layout.workspaceRailAvailable}
        onLedgerChanged={vm.refreshActiveThread}
        onOpenArtifact={onOpenArtifact}
        onClose={onCloseWorkspaceRail}
      />
    </>
  );
}

function artifactInspectionForPath(
  detail: WorkspaceViewModel["detail"],
  workspaceRoot: string,
  path: string,
): ArtifactInspection | undefined {
  if (!detail) return undefined;
  const target = taskArtifactTargets(detail.plans, detail.activePlan).find(
    (candidate) =>
      absoluteWorkspacePath(workspaceRoot, candidate.path) ===
      absoluteWorkspacePath(workspaceRoot, path),
  );
  if (!target?.artifact || !target.planId) return undefined;
  return {
    artifact: target.artifact,
    mode: "preview",
    planId: target.planId,
    threadId: detail.thread.id,
  };
}

function absoluteWorkspacePath(
  workspaceRoot: string,
  filePath: string,
): string {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized)) {
    return filePath;
  }
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${workspaceRoot.replace(/[\\/]$/u, "")}${separator}${filePath}`;
}
