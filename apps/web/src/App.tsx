import type { KeyboardEvent } from "react";
import { lazy, Suspense, useEffect, useRef } from "react";
import {
  Activity,
  AlertCircle,
  Brain,
  Cable,
  CalendarClock,
  Circle,
  ClipboardList,
  Command,
  Database,
  FolderArchive,
  GitBranch,
  Layers,
  Plus,
  RotateCcw,
  Scale,
  Send,
  ShieldCheck,
  Square,
  Target,
} from "lucide-react";

import type { GoalState, RunRecord, ThreadStatus } from "@napier/contracts";
import { InspectorTabButton } from "./InspectorTabButton";
import { FatalState, LoadingShell } from "./AppInitialStates";
import { copy } from "./copy";
import { RunDecisionDockets } from "./RunDecisionDockets";
import {
  type MessageView,
  useWorkspaceViewModel,
} from "./use-workspace-view-model";
import { shouldShowWelcomePanel, WelcomePanel } from "./WelcomePanel";

const LazyContextPanel = lazy(() => import("./ContextPanel"));
const LazyAgentCapabilityStatusBadge = lazy(
  () => import("./AgentCapabilityStatusBadge"),
);
const LazyAutomationPanel = lazy(() => import("./AutomationPanel"));
const LazyExtensionPanel = lazy(() => import("./ExtensionPanel"));
const LazyFilesPanel = lazy(() => import("./FilesPanel"));
const LazyMemoryPanel = lazy(() => import("./MemoryPanel"));
const LazyProcessPanel = lazy(() => import("./ProcessPanel"));
const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyPlanPanel = lazy(() => import("./PlanPanel"));
const LazyTracePanel = lazy(() => import("./TracePanel"));
const LazyThreadList = lazy(() => import("./ThreadList"));

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
  const modelWarningId = "composer-model-unavailable";

  return (
    <div className="app-shell">
      <nav className="ledger-nav" aria-label={copy.recentThreads}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            N
          </div>
          <div>
            <strong>{copy.appName}</strong>
            <span>{copy.appDescriptor}</span>
          </div>
        </div>

        <button
          className="new-ledger-button"
          type="button"
          onClick={() => void vm.newThread()}
        >
          <Plus size={15} aria-hidden="true" />
          {copy.newThread}
          <kbd>N</kbd>
        </button>

        <div className="nav-section-heading">
          <span>{copy.recentThreads}</span>
          <span>{String(vm.bootstrap.threads.length).padStart(2, "0")}</span>
        </div>
        <Suspense fallback={<div className="thread-list" />}>
          <LazyThreadList
            threads={vm.bootstrap.threads}
            selectedThreadId={vm.selectedThreadId}
            busyThreadId={vm.threadLifecycleBusyId}
            trashedThread={vm.trashedThreadReceipt}
            onSelect={(threadId) => void vm.selectThread(threadId)}
            onTrash={(threadId) => void vm.trashThread(threadId)}
            onRestore={() => void vm.restoreTrashedThread()}
          />
        </Suspense>

        <div className="workspace-stamp">
          <Database size={14} aria-hidden="true" />
          <div>
            <span>{copy.workspace}</span>
            <strong>{shortPath(vm.bootstrap.workspace.root)}</strong>
          </div>
          <span className="local-pill">{copy.localFirst}</span>
        </div>
      </nav>

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

        <section className="conversation" aria-label="Conversation">
          {shouldShowWelcomePanel(vm.messages) ? (
            <WelcomePanel
              canStart={activeModel.configured}
              onBootstrapUpdated={vm.commitConfigurationBootstrap}
              onPrompt={(prompt) => void vm.submit(prompt)}
              threadId={vm.detail?.thread.id}
            />
          ) : (
            <div className="message-ledger">
              {vm.messages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  {...(message.role === "assistant"
                    ? { onBranch: () => void vm.branchFrom(message.seq) }
                    : {})}
                />
              ))}
              {vm.streamingText ? (
                <StreamingCard text={vm.streamingText} />
              ) : null}
              <div ref={conversationEnd} />
            </div>
          )}
        </section>

        <RunDecisionDockets vm={vm} />

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void vm.submit();
          }}
        >
          <div className="composer-rule" aria-hidden="true">
            <span />
            <span>
              {vm.openOperatorDecision
                ? vm.openOperatorDecision.header
                : vm.isRunning
                  ? copy.runControlMode
                  : copy.inputMode}
            </span>
            <span />
          </div>
          <textarea
            aria-label={
              vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
            }
            placeholder={
              vm.isRunning ? copy.steeringPlaceholder : copy.composerPlaceholder
            }
            value={vm.composer}
            rows={3}
            disabled={
              !vm.detail ||
              Boolean(vm.openOperatorDecision) ||
              Boolean(vm.browserInteractionConfirmation)
            }
            onChange={(event) => vm.setComposer(event.target.value)}
            onKeyDown={(event) =>
              handleComposerKeys(event, () => void vm.submit())
            }
          />
          <div className="composer-footer">
            <div className="composer-hints">
              <Suspense fallback={<span>Capability contract loading...</span>}>
                <LazyAgentCapabilityStatusBadge
                  agent={activeAgent}
                  onReview={() => vm.setInspectorTab("context")}
                />
              </Suspense>
              <span>
                <Command size={12} aria-hidden="true" />
                {copy.shortcut}
              </span>
              {vm.isRunning ? (
                <label className="control-mode">
                  <span>{copy.controlMode}</span>
                  <select
                    aria-label={copy.controlMode}
                    value={vm.controlMessageMode}
                    onChange={(event) =>
                      vm.setControlMessageMode(
                        event.target.value === "follow_up"
                          ? "follow_up"
                          : "steering",
                      )
                    }
                  >
                    <option value="steering">{copy.steering}</option>
                    <option value="follow_up">{copy.followUp}</option>
                  </select>
                </label>
              ) : null}
            </div>
            {vm.isRunning ? (
              <div className="composer-run-actions">
                <button
                  className="run-button control"
                  type="submit"
                  disabled={!vm.composer.trim() || !vm.activeRunId}
                >
                  <Send size={13} aria-hidden="true" />
                  {vm.controlMessageMode === "steering"
                    ? copy.steer
                    : copy.queueFollowUp}
                </button>
                <button
                  className="run-button stop"
                  type="button"
                  onClick={() => void vm.stop()}
                >
                  <Square size={13} fill="currentColor" aria-hidden="true" />
                  {copy.stop}
                </button>
              </div>
            ) : (
              <button
                className="run-button"
                type="submit"
                disabled={!canStartRun}
                aria-describedby={
                  !activeModel.configured ? modelWarningId : undefined
                }
              >
                <Send size={14} aria-hidden="true" />
                {copy.send}
              </button>
            )}
          </div>
          {!vm.isRunning && !activeModel.configured ? (
            <p
              id={modelWarningId}
              className="composer-model-warning"
              role="status"
            >
              {copy.modelUnavailableHint}
            </p>
          ) : null}
        </form>
      </main>

      <aside className="inspector" aria-label={copy.inspect}>
        <div
          className="inspector-tabs"
          role="tablist"
          aria-label={copy.inspect}
        >
          <InspectorTabButton
            id="trace"
            active={vm.inspectorTab === "trace"}
            icon={<Activity size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.trace}
          </InspectorTabButton>
          <InspectorTabButton
            id="processes"
            active={vm.inspectorTab === "processes"}
            icon={<Command size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.processes}
          </InspectorTabButton>
          <InspectorTabButton
            id="files"
            active={vm.inspectorTab === "files"}
            icon={<FolderArchive size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.files}
          </InspectorTabButton>
          <InspectorTabButton
            id="lab"
            active={vm.inspectorTab === "lab"}
            icon={<Scale size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.lab}
          </InspectorTabButton>
          <InspectorTabButton
            id="plan"
            active={vm.inspectorTab === "plan"}
            icon={<ClipboardList size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.plan}
          </InspectorTabButton>
          <InspectorTabButton
            id="goal"
            active={vm.inspectorTab === "goal"}
            icon={<Target size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.goal}
          </InspectorTabButton>
          <InspectorTabButton
            id="memory"
            active={vm.inspectorTab === "memory"}
            icon={<Brain size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.memory}
          </InspectorTabButton>
          <InspectorTabButton
            id="extensions"
            active={vm.inspectorTab === "extensions"}
            icon={<Cable size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.extensions}
          </InspectorTabButton>
          <InspectorTabButton
            id="automations"
            active={vm.inspectorTab === "automations"}
            icon={<CalendarClock size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.automations}
          </InspectorTabButton>
          <InspectorTabButton
            id="context"
            active={vm.inspectorTab === "context"}
            icon={<Layers size={14} />}
            onClick={vm.setInspectorTab}
          >
            {copy.tabs.context}
          </InspectorTabButton>
        </div>

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
            <GoalPanel
              {...(vm.activeGoal ? { goal: vm.activeGoal } : {})}
              draft={vm.goalDraft}
              onDraft={vm.setGoalDraft}
              onSave={() => void vm.saveGoal()}
              onClear={() => void vm.removeGoal()}
            />
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
      </aside>
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

function MessageCard({
  message,
  onBranch,
}: {
  message: MessageView;
  onBranch?: () => void;
}) {
  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-gutter">
        <span>{String(message.seq).padStart(3, "0")}</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>{message.role === "user" ? "Operator" : "Napier"}</span>
          <time dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
          {message.model ? <small>{message.model}</small> : null}
        </header>
        {message.reasoning ? (
          <details className="reasoning-note">
            <summary>Reasoning note</summary>
            <p>{message.reasoning}</p>
          </details>
        ) : null}
        <div className="message-text">
          {message.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={`${message.id}-${index}`}>{paragraph}</p>
          ))}
        </div>
        {onBranch ? (
          <button className="branch-action" type="button" onClick={onBranch}>
            <GitBranch size={13} aria-hidden="true" />
            {copy.branch}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StreamingCard({ text }: { text: string }) {
  return (
    <article
      className="message-card role-assistant is-streaming"
      aria-live="polite"
    >
      <div className="message-gutter">
        <span>•••</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>Napier</span>
          <small>{copy.running}</small>
        </header>
        <div className="message-text">
          <p>{text}</p>
          <span className="ink-caret" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function GoalPanel({
  goal,
  draft,
  onDraft,
  onSave,
  onClear,
}: {
  goal?: GoalState;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <section className="panel-section" aria-labelledby="goal-title">
      <div className="panel-heading">
        <div>
          <span>OBJECTIVE</span>
          <h2 id="goal-title">{copy.goal.title}</h2>
        </div>
        {goal ? (
          <span className={`goal-state goal-${goal.status}`}>
            {goalStatusLabel(goal.status)}
          </span>
        ) : null}
      </div>
      {goal ? (
        <div className={`goal-card goal-card-${goal.status}`}>
          <div className="goal-pin">
            <Target size={18} aria-hidden="true" />
          </div>
          <p>{goal.objective}</p>
          <div className="goal-progress">
            <span
              style={{
                width: `${goalProgress(goal)}%`,
              }}
            />
          </div>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{goal.blocker.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Continuations</dt>
              <dd>
                {goal.continuationCount} / {goal.maxContinuations}
              </dd>
            </div>
            {goal.noProgressCount > 0 ? (
              <div>
                <dt>{copy.goal.noProgress}</dt>
                <dd>
                  {goal.noProgressCount} / {goal.maxNoProgressContinuations}
                </dd>
              </div>
            ) : null}
          </dl>
          {goal.evidence ? (
            <div className="evidence-note">
              <span>{copy.goal.evidence}</span>
              <p>{goal.evidence}</p>
            </div>
          ) : null}
          <button
            className="text-button danger"
            type="button"
            onClick={onClear}
          >
            {copy.goal.clear}
          </button>
        </div>
      ) : (
        <div className="goal-empty">
          <div className="empty-orbit" aria-hidden="true">
            <Circle size={44} />
            <Target size={17} />
          </div>
          <p>{copy.goal.empty}</p>
          <textarea
            rows={5}
            value={draft}
            placeholder={copy.goal.placeholder}
            onChange={(event) => onDraft(event.target.value)}
          />
          <button
            className="primary-wide"
            type="button"
            disabled={!draft.trim()}
            onClick={onSave}
          >
            <Target size={14} aria-hidden="true" />
            {copy.goal.set}
          </button>
        </div>
      )}
      <p className="guardrail-note">
        <ShieldCheck size={13} aria-hidden="true" />
        {copy.goal.guardrail}
      </p>
    </section>
  );
}

function handleComposerKeys(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  }
}

function statusLabel(status?: ThreadStatus): string {
  if (status === "failed") return copy.failed;
  if (status === "waiting") return copy.waiting;
  return copy.idle;
}

function goalStatusLabel(status: GoalState["status"]): string {
  if (status === "completed") return copy.goal.completed;
  if (status === "blocked") return copy.goal.blocked;
  return copy.goal.active;
}

function goalProgress(goal: GoalState): number {
  if (goal.status === "completed") return 100;
  return Math.max(
    7,
    (goal.continuationCount / Math.max(1, goal.maxContinuations)) * 100,
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : value;
}
