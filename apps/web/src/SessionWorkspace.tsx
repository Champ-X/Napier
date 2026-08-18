import { lazy, Suspense } from "react";
import type { KeyboardEvent } from "react";
import {
  Archive,
  CalendarClock,
  FlaskConical,
  FolderArchive,
  Globe2,
  ListChecks,
  Target,
  TerminalSquare,
  Wrench,
} from "lucide-react";

import { copy } from "./copy";
import { KernelPluginInspectorSlots } from "./KernelPluginInspectorSlots";
import { PlanInspectorSurface } from "./PlanInspectorSurface";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyFilesPanel = lazy(() => import("./FilesPanel"));
const LazyGoalPanel = lazy(() => import("./GoalPanel"));
const LazyProcessPanel = lazy(() => import("./ProcessPanel"));
const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyAutomationPanel = lazy(() => import("./AutomationPanel"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;
export type SessionSection =
  | "plan"
  | "studio"
  | "goal"
  | "files"
  | "browser"
  | "processes"
  | "lab"
  | "automations";

const SESSION_SECTIONS: ReadonlyArray<{
  id: SessionSection;
  label: string;
  icon: typeof Archive;
}> = [
  { id: "plan", label: copy.sections.plan, icon: ListChecks },
  { id: "studio", label: copy.sections.studio, icon: Wrench },
  { id: "goal", label: copy.sections.goal, icon: Target },
  { id: "files", label: copy.sections.files, icon: FolderArchive },
  { id: "browser", label: copy.sections.browser, icon: Globe2 },
  { id: "processes", label: copy.sections.processes, icon: TerminalSquare },
  { id: "lab", label: copy.sections.lab, icon: FlaskConical },
  { id: "automations", label: copy.sections.automations, icon: CalendarClock },
];

export function SessionWorkspace({
  vm,
  section,
  activeModel,
  onSection,
  onConversation,
}: {
  vm: WorkspaceViewModel;
  section: SessionSection;
  activeModel: WorkspaceViewModel["selectedModel"];
  onSection(section: SessionSection): void;
  onConversation(): void;
}) {
  return (
    <div className="session-workspace">
      <header className="session-workspace-heading">
        <div>
          <span>{copy.sessionView.eyebrow}</span>
          <h2>{copy.sessionView.title}</h2>
          <p>{copy.sessionView.body}</p>
        </div>
        <dl className="session-stats">
          <Stat
            label={copy.sessionView.runs}
            value={vm.detail?.runs.length ?? 0}
          />
          <Stat
            label={copy.sessionView.plans}
            value={vm.detail?.plans.length ?? 0}
          />
          <Stat
            label={copy.sessionView.events}
            value={vm.detail?.events.length ?? 0}
          />
        </dl>
      </header>
      <nav
        className="session-tool-navigation"
        aria-label={copy.sessionView.tools}
        role="tablist"
      >
        {SESSION_SECTIONS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              id={`session-section-${entry.id}`}
              type="button"
              className={section === entry.id ? "is-active" : ""}
              role="tab"
              aria-selected={section === entry.id}
              aria-controls="session-content-panel"
              tabIndex={section === entry.id ? 0 : -1}
              key={entry.id}
              onClick={() => onSection(entry.id)}
              onKeyDown={(event) =>
                moveSessionSection(event, entry.id, onSection)
              }
            >
              <Icon size={13} aria-hidden="true" />
              {entry.label}
            </button>
          );
        })}
      </nav>
      <section
        id="session-content-panel"
        className="session-content-surface"
        role="tabpanel"
        aria-labelledby={`session-section-${section}`}
      >
        {section === "plan" || section === "studio" ? (
          <PlanInspectorSurface
            surface={section}
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
        ) : null}
        {section === "goal" ? (
          <Suspense fallback={<PanelLoading label={copy.goal.title} />}>
            <LazyGoalPanel
              {...(vm.activeGoal ? { goal: vm.activeGoal } : {})}
              draft={vm.goalDraft}
              onDraft={vm.setGoalDraft}
              onSave={() => void vm.saveGoal()}
              onClear={() => void vm.removeGoal()}
            />
          </Suspense>
        ) : null}
        {section === "files" && vm.detail ? (
          <Suspense fallback={<PanelLoading label={copy.filesLoading} />}>
            <LazyFilesPanel threadId={vm.detail.thread.id} />
          </Suspense>
        ) : null}
        {section === "browser" ? (
          <KernelPluginInspectorSlots
            plugins={vm.bootstrap?.plugins}
            activeTab="browser"
            browser={{
              events: vm.detail?.events ?? [],
              activeRunId: vm.activeRunId,
              taskContext: {
                models: vm.bootstrap?.models ?? [],
                credentials: vm.bootstrap?.credentials ?? [],
                selectedModel: activeModel,
              },
            }}
          />
        ) : null}
        {section === "processes" && vm.detail ? (
          <Suspense fallback={<PanelLoading label={copy.processLoading} />}>
            <LazyProcessPanel
              threadId={vm.detail.thread.id}
              onThreadChanged={vm.refreshActiveThread}
            />
          </Suspense>
        ) : null}
        {section === "lab" ? (
          <Suspense fallback={<PanelLoading label={copy.lab.title} />}>
            <LazyRunLabPanel
              detail={vm.detail}
              runs={vm.terminalRuns}
              evaluations={vm.detail?.evaluations ?? []}
              comparison={vm.runComparison}
              leftRunId={vm.labLeftRunId}
              rightRunId={vm.labRightRunId}
              selectedModelKey={vm.selectedModelKey}
              models={vm.bootstrap?.models ?? []}
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
              onUseTaskPrompt={(prompt) => {
                vm.setComposer(prompt);
                onConversation();
                window.setTimeout(
                  () =>
                    document
                      .querySelector<HTMLTextAreaElement>(".composer textarea")
                      ?.focus(),
                  0,
                );
              }}
            />
          </Suspense>
        ) : null}
        {section === "automations" && vm.detail && vm.bootstrap ? (
          <Suspense fallback={<PanelLoading label={copy.automationLoading} />}>
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
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="context-loading" role="status">
      {label}
    </div>
  );
}

function moveSessionSection(
  event: KeyboardEvent<HTMLButtonElement>,
  current: SessionSection,
  onSection: (section: SessionSection) => void,
): void {
  const index = SESSION_SECTIONS.findIndex((entry) => entry.id === current);
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % SESSION_SECTIONS.length
      : event.key === "ArrowLeft"
        ? (index - 1 + SESSION_SECTIONS.length) % SESSION_SECTIONS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? SESSION_SECTIONS.length - 1
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  const section = SESSION_SECTIONS[next]!;
  onSection(section.id);
  requestAnimationFrame(() =>
    document.getElementById(`session-section-${section.id}`)?.focus(),
  );
}
