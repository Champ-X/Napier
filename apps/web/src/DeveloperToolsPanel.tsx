import { FlaskConical, Gauge, Workflow } from "lucide-react";
import { lazy, Suspense } from "react";

import { copy } from "./copy";
import { PlanInspectorSurface } from "./PlanInspectorSurface";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyRunLabPanel = lazy(() => import("./RunLabPanel"));
const LazyDefaultProductTrialRecorder = lazy(
  () => import("./DefaultProductTrialRecorder"),
);
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function DeveloperToolsPanel({
  vm,
  activeModel,
  onConversation,
}: {
  vm: WorkspaceViewModel;
  activeModel: WorkspaceViewModel["selectedModel"];
  onConversation(): void;
}) {
  return (
    <section className="developer-tools" aria-labelledby="developer-tools-title">
      <header>
        <span>{copy.settingsSurface.developerSection}</span>
        <h2 id="developer-tools-title">{copy.settingsSurface.developerSection}</h2>
        <p>{copy.settingsSurface.developerIntro}</p>
      </header>

      <details className="developer-tool" open>
        <summary>
          <FlaskConical size={16} aria-hidden="true" />
          {copy.settingsSurface.runLab}
        </summary>
        <Suspense fallback={<div className="context-loading" role="status" />}>
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
            onVerifyReplay={(file) => void vm.verifyRunReplaySnapshotFile(file)}
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
      </details>

      <details className="developer-tool">
        <summary>
          <Workflow size={16} aria-hidden="true" />
          {copy.settingsSurface.workflowStudio}
        </summary>
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
      </details>

      {vm.detail ? (
        <details className="developer-tool">
          <summary>
            <Gauge size={16} aria-hidden="true" />
            {copy.settingsSurface.productTrial}
          </summary>
          <Suspense fallback={<div className="context-loading" role="status" />}>
            <LazyDefaultProductTrialRecorder
              threadId={vm.detail.thread.id}
              runs={vm.detail.runs}
            />
          </Suspense>
        </details>
      ) : null}
    </section>
  );
}
