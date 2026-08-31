import { FlaskConical, Gauge, GitFork, Workflow } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from "react";

import { copy } from "./copy";
import { developerToolsCopy as t } from "./developer-tools-copy";
import { ContextCompactionWorkbenchPanel } from "./ContextCompactionWorkbenchPanel";
import { PlanInspectorSurface } from "./PlanInspectorSurface";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyDefaultProductTrialRecorder = lazy(() =>
  import("./DefaultProductTrialRecorder").then(
    ({ DefaultProductTrialRecorder }) => ({
      default: DefaultProductTrialRecorder,
    }),
  ),
);
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;
type DeveloperToolId = "lab" | "compaction" | "workflow" | "trial";

const DEVELOPER_TOOLS = [
  {
    id: "lab",
    icon: FlaskConical,
    label: copy.settingsSurface.runLab,
    description: t.descriptions.lab,
  },
  {
    id: "compaction",
    icon: GitFork,
    label: copy.settingsSurface.contextCompaction.title,
    description: t.descriptions.compaction,
  },
  {
    id: "workflow",
    icon: Workflow,
    label: copy.settingsSurface.workflowStudio,
    description: t.descriptions.workflow,
  },
  {
    id: "trial",
    icon: Gauge,
    label: copy.settingsSurface.productTrial,
    description: t.descriptions.trial,
  },
] as const satisfies ReadonlyArray<{
  id: DeveloperToolId;
  icon: typeof FlaskConical;
  label: string;
  description: string;
}>;

export function DeveloperToolsPanel({
  vm,
  activeModel,
  onConversation,
  hidden = false,
}: {
  vm: WorkspaceViewModel;
  activeModel: WorkspaceViewModel["selectedModel"];
  onConversation(): void;
  hidden?: boolean;
}) {
  const [tool, setTool] = useState<DeveloperToolId>("lab");
  const [visitedTools, setVisitedTools] = useState<
    ReadonlySet<DeveloperToolId>
  >(() => new Set(["lab"]));
  const hasDetail = Boolean(vm.detail);
  const enabledToolIds = DEVELOPER_TOOLS.flatMap((entry) =>
    entry.id === "trial" && !hasDetail ? [] : [entry.id],
  );

  const activateTool = (nextTool: DeveloperToolId) => {
    setVisitedTools((current) => {
      if (current.has(nextTool)) return current;
      const next = new Set(current);
      next.add(nextTool);
      return next;
    });
    setTool(nextTool);
  };

  useEffect(() => {
    if (tool === "trial" && !hasDetail) setTool("lab");
  }, [hasDetail, tool]);

  return (
    <section
      className="developer-tools"
      aria-labelledby="developer-tools-title"
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
    >
      <header>
        <span>{copy.settingsSurface.developerSection}</span>
        <h2 id="developer-tools-title">
          {copy.settingsSurface.developerSection}
        </h2>
        <p>{copy.settingsSurface.developerIntro}</p>
      </header>
      <dl className="developer-tool-status" aria-label={t.statusLabel}>
        <Status label={t.runs} value={vm.terminalRuns.length} />
        <Status label={t.events} value={vm.detail?.events.length ?? 0} />
        <Status label={t.plans} value={vm.detail?.plans.length ?? 0} />
        <Status
          label={t.model}
          value={activeModel.configured ? t.ready : t.unavailable}
        />
      </dl>
      <nav
        className="developer-tool-navigation"
        role="tablist"
        aria-label={t.toolsLabel}
      >
        {DEVELOPER_TOOLS.map((entry) => {
          const Icon = entry.icon;
          const disabled = entry.id === "trial" && !hasDetail;
          return (
            <button
              id={developerToolTabId(entry.id)}
              type="button"
              role="tab"
              aria-selected={tool === entry.id}
              aria-controls={developerToolPanelId(entry.id)}
              tabIndex={tool === entry.id ? 0 : -1}
              className={tool === entry.id ? "is-active" : ""}
              disabled={disabled}
              key={entry.id}
              onClick={() => activateTool(entry.id)}
              onKeyDown={(event) =>
                moveDeveloperTool(event, entry.id, enabledToolIds, activateTool)
              }
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.description}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <div
        id={developerToolPanelId("lab")}
        className="developer-tool-content"
        role="tabpanel"
        aria-labelledby={developerToolTabId("lab")}
        hidden={tool !== "lab"}
      >
        {visitedTools.has("lab") ? (
          <Suspense
            fallback={<div className="context-loading" role="status" />}
          >
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
      </div>

      <div
        id={developerToolPanelId("compaction")}
        className="developer-tool-content"
        role="tabpanel"
        aria-labelledby={developerToolTabId("compaction")}
        hidden={tool !== "compaction"}
      >
        {visitedTools.has("compaction") ? (
          <ContextCompactionWorkbenchPanel
            {...(vm.detail
              ? {
                  threadId: vm.detail.thread.id,
                  threadTitle: vm.detail.thread.title,
                }
              : {})}
            messageCount={vm.messages.length}
            model={activeModel}
            running={vm.isRunning}
            onOpenThread={vm.selectThread}
            onRefresh={vm.refreshActiveThread}
          />
        ) : null}
      </div>

      <div
        id={developerToolPanelId("workflow")}
        className="developer-tool-content"
        role="tabpanel"
        aria-labelledby={developerToolTabId("workflow")}
        hidden={tool !== "workflow"}
      >
        {visitedTools.has("workflow") ? (
          <PlanInspectorSurface
            surface="studio"
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
      </div>

      <div
        id={developerToolPanelId("trial")}
        className="developer-tool-content"
        role="tabpanel"
        aria-labelledby={developerToolTabId("trial")}
        hidden={tool !== "trial"}
      >
        {visitedTools.has("trial") && vm.detail ? (
          <Suspense
            fallback={<div className="context-loading" role="status" />}
          >
            <LazyDefaultProductTrialRecorder
              threadId={vm.detail.thread.id}
              runs={vm.detail.runs}
            />
          </Suspense>
        ) : null}
      </div>
    </section>
  );
}

function developerToolTabId(tool: DeveloperToolId): string {
  return `developer-tool-tab-${tool}`;
}

function developerToolPanelId(tool: DeveloperToolId): string {
  return `developer-tool-panel-${tool}`;
}

function moveDeveloperTool(
  event: KeyboardEvent<HTMLButtonElement>,
  current: DeveloperToolId,
  enabledTools: readonly DeveloperToolId[],
  onTool: (tool: DeveloperToolId) => void,
): void {
  const currentIndex = enabledTools.indexOf(current);
  if (currentIndex < 0) return;
  let nextIndex: number | undefined;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % enabledTools.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + enabledTools.length) % enabledTools.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = enabledTools.length - 1;
  }
  if (nextIndex === undefined) return;
  event.preventDefault();
  const nextTool = enabledTools[nextIndex]!;
  onTool(nextTool);
  document.getElementById(developerToolTabId(nextTool))?.focus();
}

function Status({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
