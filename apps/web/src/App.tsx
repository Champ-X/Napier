import { lazy, Suspense, useEffect, useRef } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

import type { RunRecord, ThreadStatus } from "@napier/contracts";
import { FatalState, LoadingShell } from "./AppInitialStates";
import { Composer } from "./Composer";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { copy } from "./copy";
import { InspectorNavigation } from "./InspectorNavigation";
import { LedgerNavigation } from "./LedgerNavigation";
import { ResponsiveInspector } from "./ResponsiveInspector";
import { RunDecisionDockets } from "./RunDecisionDockets";
import { TaskNarrativeBar } from "./TaskNarrativeBar";
import { useWorkspaceViewModel } from "./use-workspace-view-model";
const LazyContextPanel = lazy(() => import("./ContextPanel"));
const LazyGoalPanel = lazy(() => import("./GoalPanel"));
const LazyAutomationPanel = lazy(() => import("./AutomationPanel"));
const LazyExtensionPanel = lazy(() => import("./ExtensionPanel"));
const LazyFilesPanel = lazy(() => import("./FilesPanel"));
const LazyMemoryPanel = lazy(() => import("./MemoryPanel"));
const LazyProcessPanel = lazy(() => import("./ProcessPanel"));
const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyPlanPanel = lazy(() => import("./PlanPanel"));
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

  if (vm.isLoading) return <LoadingShell />;
  if (!vm.bootstrap)
    return <FatalState message={vm.error ?? copy.notices.disconnected} />;

  const activeAgent = vm.detail?.agent ?? vm.bootstrap.agents[0];
  const activeModel = vm.selectedModel;
  const canStartRun = Boolean(
    vm.composer.trim() &&
    vm.detail &&
    !vm.openOperatorDecision &&
    activeModel.configured,
  );

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
        <header className="workbench-header">
          <div className="thread-heading">
            <span className="folio-number">
              Folio {String(vm.detail?.thread.eventCount ?? 0).padStart(3, "0")}
            </span>
            <h1>{vm.detail?.thread.title ?? copy.welcome.title}</h1>
          </div>
          <div className="run-meta">
            <div
              className={`model-chip ${
                activeModel.configured ? "" : "is-unavailable"
              }`}
              title={
                activeModel.configured
                  ? activeModel.key
                  : `${activeModel.key} · ${copy.modelUnavailable}`
              }
            >
              <span className="model-glyph" aria-hidden="true">
                {activeModel.provider === "napier" ? "D" : "L"}
              </span>
              <span>
                <small>
                  {!activeModel.configured
                    ? copy.modelUnavailable
                    : activeModel.provider === "napier"
                      ? copy.context.demoProvider
                      : copy.context.liveProvider}
                </small>
                <strong>{activeModel.id}</strong>
              </span>
            </div>
            <div
              className={`run-status ${vm.isRunning ? "is-running" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span />
              {vm.isRunning
                ? copy.running
                : statusLabel(vm.detail?.thread.status)}
            </div>
          </div>
        </header>

        <TaskNarrativeBar detail={vm.detail} />
        <div className="workbench-notices">
          {vm.error ? (
            <div className="error-banner" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{vm.error}</span>
            </div>
          ) : null}

          {vm.resumableRun ? (
            <RecoveryBanner
              run={vm.resumableRun}
              running={vm.isRunning}
              modelConfigured={activeModel.configured}
              onResume={() => void vm.resume()}
            />
          ) : null}
        </div>

        <ConversationWorkspace
          vm={vm}
          canStart={activeModel.configured}
          endRef={conversationEnd}
        />
        <RunDecisionDockets vm={vm} />

        <Composer
          vm={vm}
          activeAgent={activeAgent}
          activeModel={activeModel}
          canStartRun={canStartRun}
        />
      </main>

      <ResponsiveInspector label={copy.inspect}>
        <InspectorNavigation
          activeTab={vm.inspectorTab}
          onChange={vm.setInspectorTab}
        />

        <div className="inspector-body">
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
                onVerify={(file) =>
                  void vm.verifyOpenTelemetryTraceArtifactFile(file)
                }
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
              <LazyProcessPanel
                threadId={vm.detail.thread.id}
                onThreadChanged={vm.refreshActiveThread}
              />
            </Suspense>
          ) : null}
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
                onVerifyReplay={(file) =>
                  void vm.verifyRunReplaySnapshotFile(file)
                }
                onExportFixture={() => void vm.exportThreadFixture()}
                onVerifyFixture={(file) => void vm.verifyThreadFixture(file)}
                onImportFixture={(file) => void vm.importThreadFixture(file)}
                onOpenThread={vm.selectThread}
                onRefresh={vm.refreshActiveThread}
              />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "plan" ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.planLoading}
                </div>
              }
            >
              <LazyPlanPanel
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
            </Suspense>
          ) : null}
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
                memories={vm.bootstrap.memories.filter(
                  (memory) =>
                    memory.scope === "workspace" ||
                    memory.agentId === activeAgent?.id,
                )}
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
                onReview={(memoryId, action) =>
                  void vm.reviewMemoryFact(memoryId, action)
                }
              />
            </Suspense>
          ) : null}
          {vm.inspectorTab === "extensions" && activeAgent ? (
            <Suspense
              fallback={
                <div className="context-loading" role="status">
                  {copy.extensionLoading}
                </div>
              }
            >
              <LazyExtensionPanel
                extensions={vm.bootstrap.extensions}
                publisherAnchors={vm.bootstrap.extensionPublisherTrustAnchors}
                agentId={activeAgent.id}
                busyId={vm.extensionBusyId}
                packageReceipt={vm.extensionPackageReceipt}
                packageDeploymentPreview={vm.extensionPackageDeploymentPreview}
                packageRolloutPreview={vm.extensionPackageRolloutPreview}
                packageRolloutChannels={
                  vm.bootstrap.extensionPackageRolloutChannels
                }
                packageUpdatePreview={vm.extensionPackageUpdatePreview}
                onPropose={vm.proposeMcpExtension}
                onReview={(extensionId, action) =>
                  void vm.reviewExtensionTrust(extensionId, action)
                }
                onConnect={(extensionId) =>
                  void vm.connectMcpExtension(extensionId)
                }
                onDisconnect={(extensionId) =>
                  void vm.disconnectMcpExtension(extensionId)
                }
                onToolReview={(
                  extensionId,
                  toolName,
                  action,
                  effect,
                  routingHint,
                ) =>
                  void vm.reviewExtensionTool(
                    extensionId,
                    toolName,
                    action,
                    effect,
                    routingHint,
                  )
                }
                onToggle={(extensionId, enabled) =>
                  void vm.toggleExtension(extensionId, enabled)
                }
                onCreatePublisher={vm.createExtensionPublisher}
                onRevokePublisher={vm.revokeExtensionPublisher}
                onSignPackage={vm.downloadSignedExtensionPackage}
                onVerifyPackage={vm.verifySignedExtensionPackageFile}
                onImportPackage={vm.importSignedExtensionPackageFile}
                onExportPackageLockfile={vm.exportExtensionPackageLockfile}
                onDownloadPackageChannelIndex={
                  vm.downloadExtensionPackageChannelIndex
                }
                onPublishPackageRollout={
                  vm.publishExtensionPackageRolloutChannel
                }
                onPreviewPackageRollout={
                  vm.previewExtensionPackageRolloutChannel
                }
                onPreviewPackageUpdate={vm.previewExtensionPackageUpdateFile}
                onApplyPackageUpdate={vm.applyExtensionPackageUpdate}
                onCancelPackageUpdate={vm.cancelExtensionPackageUpdate}
                onPreviewPackageDeployment={
                  vm.previewExtensionPackageDeploymentFiles
                }
                onApplyPackageDeployment={vm.applyExtensionPackageDeployment}
                onCancelPackageDeployment={vm.cancelExtensionPackageDeployment}
              />
            </Suspense>
          ) : null}
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
                      !vm.detail?.automaticRecoveryAssessments.some(
                        (assessment) => assessment.runId === run.id,
                      ),
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
                skills={vm.bootstrap.skills.map((skill) => skill.name)}
                models={vm.bootstrap.models}
                credentials={vm.bootstrap.credentials}
                publisherAnchors={vm.bootstrap.extensionPublisherTrustAnchors}
                skillPackageInstallations={
                  vm.bootstrap.skillPackageInstallations
                }
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
                {...(vm.contextCheckpoint
                  ? { checkpoint: vm.contextCheckpoint }
                  : {})}
              />
            </Suspense>
          ) : null}
        </div>
      </ResponsiveInspector>
    </div>
  );
}

function RecoveryBanner({
  run,
  running,
  modelConfigured,
  onResume,
}: {
  run: RunRecord;
  running: boolean;
  modelConfigured: boolean;
  onResume: () => void;
}) {
  const resumeWarningId = "recovery-model-unavailable";
  return (
    <section className="recovery-banner" aria-labelledby="recovery-title">
      <div className="recovery-mark" aria-hidden="true">
        <RotateCcw size={16} />
      </div>
      <div>
        <span>{copy.recovery.eyebrow}</span>
        <h2 id="recovery-title">{copy.recovery.title}</h2>
        <p>{copy.recovery.body}</p>
        <code>
          {copy.recovery.run}: {run.id}
        </code>
      </div>
      <div className="recovery-actions">
        {!modelConfigured ? (
          <p id={resumeWarningId}>{copy.modelUnavailableHint}</p>
        ) : null}
        <button
          type="button"
          disabled={running || !modelConfigured}
          aria-describedby={!modelConfigured ? resumeWarningId : undefined}
          onClick={onResume}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {copy.recovery.action}
        </button>
      </div>
    </section>
  );
}

function statusLabel(status?: ThreadStatus): string {
  if (status === "failed") return copy.failed;
  if (status === "waiting") return copy.waiting;
  return copy.idle;
}
