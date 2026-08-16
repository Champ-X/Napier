import { lazy, Suspense, useEffect, useRef } from "react";

import { FatalState, LoadingShell } from "./AppInitialStates";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { copy } from "./copy";
import { ExtensionInspectorSurface } from "./ExtensionInspectorSurface";
import { InspectorNavigation, InspectorPanel } from "./InspectorNavigation";
import { KernelPluginInspectorSlots } from "./KernelPluginInspectorSlots";
import { LedgerNavigation } from "./LedgerNavigation";
import { PlanInspectorSurface } from "./PlanInspectorSurface";
import { ResponsiveInspector } from "./ResponsiveInspector";
import { TaskNarrativeBoundary } from "./TaskNarrativeBoundary";
import { useTaskControlNavigation } from "./use-task-control-navigation";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
import { WorkbenchDeferredDecisions, WorkbenchDeferredNotices } from "./WorkbenchDeferredPanels";
import { WorkbenchHeader } from "./WorkbenchHeader";
const LazyContextPanel = lazy(() => import("./ContextPanel"));
const LazyGoalPanel = lazy(() => import("./GoalPanel"));
const LazyAutomationPanel = lazy(() => import("./AutomationPanel"));
const LazyFilesPanel = lazy(() => import("./FilesPanel"));
const LazyMemoryPanel = lazy(() => import("./MemoryPanel"));
const LazyProcessPanel = lazy(() => import("./ProcessPanel"));
const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyTracePanel = lazy(() => import("./TracePanel"));
export function App() {
  const vm = useWorkspaceViewModel();
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({
      behavior: vm.isRunning ? "smooth" : "instant",
      block: "end",
    });
  }, [vm.messages.length, vm.streamingText, vm.isRunning]);

  const taskControls = useTaskControlNavigation({
    activeRunId: vm.activeRunId,
    events: vm.detail?.events ?? [],
    onSelectInspector: vm.setInspectorTab,
  });

  if (vm.isLoading) return <LoadingShell />;
  if (!vm.bootstrap) return <FatalState message={vm.error ?? copy.notices.disconnected} />;

  const activeAgent = vm.detail?.agent ?? vm.bootstrap.agents[0];
  const activeModel = vm.selectedModel;
  const canStartRun = Boolean(vm.composer.trim() && vm.detail && !vm.openOperatorDecision && activeModel.configured);
  return (
    <div className="app-shell">
      <LedgerNavigation
        bootstrap={vm.bootstrap}
        selectedThreadId={vm.selectedThreadId}
        busyThreadId={vm.threadLifecycleBusyId}
        trashedThread={vm.trashedThreadReceipt}
        onNewThread={() => void vm.newThread()}
        onSelect={(threadId) => void vm.selectThread(threadId)}
        onTrash={(threadId) => void vm.trashThread(threadId)}
        onRestore={() => void vm.restoreTrashedThread()}
      />
      <main className="workbench">
        <WorkbenchHeader
          eventCount={vm.detail?.thread.eventCount ?? 0}
          isRunning={vm.isRunning}
          model={activeModel}
          status={vm.detail?.thread.status}
          title={vm.detail?.thread.title ?? copy.welcome.title}
        />
        <TaskNarrativeBoundary
          detail={vm.detail}
          browserControlsAvailable={taskControls.browserControlsAvailable}
          onOpenArtifact={taskControls.openArtifact}
          onOpenBrowserControls={taskControls.openBrowserControls}
          onStop={() => void vm.stop()}
        />
        <WorkbenchDeferredNotices vm={vm} />
        <ConversationWorkspace vm={vm} endRef={conversationEnd} />
        <WorkbenchDeferredDecisions vm={vm} browserControlsAvailable={taskControls.browserControlsAvailable} />
        <Composer
          vm={vm}
          activeAgent={activeAgent}
          activeModel={activeModel}
          canStartRun={canStartRun}
          onOpenInspector={taskControls.openInspector}
        />
      </main>

      <ResponsiveInspector label={copy.inspect} openRequest={taskControls.inspectorOpenRequest}>
        <InspectorNavigation activeTab={vm.inspectorTab} onChange={vm.setInspectorTab} />

        <InspectorPanel activeTab={vm.inspectorTab}>
          {vm.inspectorTab === "trace" ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.trace.title}
                </div>
              }
            >
              <LazyTracePanel
                events={vm.visibleTrace}
                subagents={vm.detail?.subagents ?? []}
                runs={vm.detail?.runs ?? []}
                running={vm.isRunning}
                exportBusy={vm.traceExportBusy}
                exportReceipt={vm.traceExportReceipt}
                verifyBusy={vm.traceVerifyBusy}
                verificationReceipt={vm.traceVerificationReceipt}
                reviewerModel={{
                  provider: activeModel.provider,
                  id: activeModel.id,
                }}
                reviewerModelConfigured={activeModel.configured}
                onExport={(runId) => void vm.exportOpenTelemetryTrace(runId)}
                onVerify={(file) => void vm.verifyOpenTelemetryTraceArtifactFile(file)}
              />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "processes" && vm.detail ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.processLoading}
                </div>
              }
            >
              <LazyProcessPanel threadId={vm.detail.thread.id} onThreadChanged={vm.refreshActiveThread} />
            </Suspense>
          ) : null}
          <KernelPluginInspectorSlots
            plugins={vm.bootstrap.plugins} activeTab={vm.inspectorTab}
            browser={{
              events: vm.detail?.events ?? [],
              activeRunId: vm.activeRunId,
              taskContext: {
                models: vm.bootstrap.models,
                credentials: vm.bootstrap.credentials,
                selectedModel: activeModel,
              },
            }}
          />
          {vm.inspectorTab === "files" && vm.detail ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.filesLoading}
                </div>
              }
            >
              <LazyFilesPanel threadId={vm.detail.thread.id} />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "lab" ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.lab.title}
                </div>
              }
            >
              <LazyRunLabPanel
                detail={vm.detail}
                runs={vm.terminalRuns}
                evaluations={vm.detail?.evaluations ?? []}
                comparison={vm.runComparison}
                leftRunId={vm.labLeftRunId}
                rightRunId={vm.labRightRunId}
                selectedModelKey={vm.selectedModelKey}
                models={vm.bootstrap.models}
                running={vm.isRunning}
                busyAction={vm.labBusyAction}
                fixtureReceipt={vm.labFixtureReceipt}
                replayVerificationReceipt={vm.runReplayVerificationReceipt}
                onLeftRun={vm.selectLabLeftRun}
                onRightRun={vm.selectLabRightRun}
                onCompare={() => void vm.compareSelectedRuns()}
                onEvaluate={() => void vm.evaluateSelectedRuns()}
                onExport={(runId) => void vm.exportRunReplay(runId)}
                onVerifyReplay={(file) => void vm.verifyRunReplaySnapshotFile(file)}
                onExportFixture={() => void vm.exportThreadFixture()}
                onVerifyFixture={(file) => void vm.verifyThreadFixture(file)}
                onImportFixture={(file) => void vm.importThreadFixture(file)}
                onOpenThread={vm.selectThread}
                onRefresh={vm.refreshActiveThread}
                onUseTaskPrompt={(prompt) => {
                  vm.setComposer(prompt);
                  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(), 0);
                }}
              />
            </Suspense>
          ) : null}
          <PlanInspectorSurface
            surface={vm.inspectorTab}
            threadId={vm.detail?.thread.id}
            plans={vm.detail?.plans ?? []}
            events={vm.detail?.events ?? []}
            running={vm.isRunning}
            selectedModelKey={vm.selectedModelKey}
            selectedModelConfigured={activeModel.configured}
            onContinue={() => void vm.submit(copy.planNextPrompt)}
            onDraftApplied={() => void vm.refreshActiveThread()}
            onOpenThread={vm.selectThread}
          />
          {vm.inspectorTab === "goal" ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.goal.title}
                </div>
              }
            >
              <LazyGoalPanel
                {...(vm.activeGoal ? { goal: vm.activeGoal } : {})}
                draft={vm.goalDraft}
                onDraft={vm.setGoalDraft}
                onSave={() => void vm.saveGoal()}
                onClear={() => void vm.removeGoal()}
              />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "memory" ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.memory.loading}
                </div>
              }
            >
              <LazyMemoryPanel
                memories={vm.bootstrap.memories.filter((memory) => memory.scope === "workspace" || memory.agentId === activeAgent?.id)}
                draft={vm.memoryDraft}
                category={vm.memoryCategory}
                scope={vm.memoryScope}
                reviewIntervalDays={vm.memoryReviewIntervalDays}
                supersedesMemoryId={vm.memorySupersedesId}
                consolidatesMemoryIds={vm.memoryConsolidatesIds}
                onDraft={vm.setMemoryDraft}
                onCategory={vm.setMemoryCategory}
                onScope={vm.setMemoryScope}
                onReviewIntervalDays={vm.setMemoryReviewIntervalDays}
                onSave={() => void vm.saveMemory()}
                onCorrect={vm.startMemoryCorrection}
                onCancelCorrection={vm.cancelMemoryCorrection}
                onToggleConsolidation={vm.toggleMemoryConsolidation}
                onCancelConsolidation={vm.cancelMemoryConsolidation}
                onReview={(memoryId, action) => void vm.reviewMemoryFact(memoryId, action)}
              />
            </Suspense>
          ) : null}
          {activeAgent ? <ExtensionInspectorSurface vm={vm} agentId={activeAgent.id} /> : null}
          {vm.inspectorTab === "automations" && vm.detail ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.automationLoading}
                </div>
              }
            >
              <LazyAutomationPanel
                threadId={vm.detail.thread.id}
                schedules={vm.bootstrap.schedules}
                channels={vm.bootstrap.channels}
                inboundChannelAdapters={vm.bootstrap.inboundChannelAdapters}
                recoveryAssessments={vm.detail.automaticRecoveryAssessments}
                recoveryAttempts={vm.detail.automaticRecoveryAttempts}
                recoveryPending={
                  vm.detail.thread.status === "waiting" &&
                  vm.detail.runs.some(
                    (run) =>
                      run.status === "interrupted" &&
                      !vm.detail?.automaticRecoveryAssessments.some((assessment) => assessment.runId === run.id),
                  )
                }
                onBootstrapUpdated={vm.commitConfigurationBootstrap}
              />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "context" && activeAgent && vm.detail ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.context.loading}
                </div>
              }
            >
              <LazyContextPanel
                agent={activeAgent}
                workspace={vm.bootstrap.workspace.root}
                skills={vm.bootstrap.skills}
                models={vm.bootstrap.models}
                credentials={vm.bootstrap.credentials}
                publisherAnchors={vm.bootstrap.extensionPublisherTrustAnchors}
                skillPackageInstallations={vm.bootstrap.skillPackageInstallations}
                usagePriceTableCatalog={vm.bootstrap.usagePriceTableCatalog}
                threadId={vm.detail.thread.id}
                selectedModelKey={vm.selectedModelKey}
                onModel={vm.setSelectedModelKey}
                onAgentUpdated={vm.commitAgentConfiguration}
                onBootstrapUpdated={vm.commitConfigurationBootstrap}
                {...(vm.contextCheckpointCalibration
                  ? {
                      checkpointCalibration: vm.contextCheckpointCalibration,
                    }
                  : {})}
                {...(vm.contextCheckpoint ? { checkpoint: vm.contextCheckpoint } : {})}
              />
            </Suspense>
          ) : null}
        </InspectorPanel>
      </ResponsiveInspector>
    </div>
  );
}
