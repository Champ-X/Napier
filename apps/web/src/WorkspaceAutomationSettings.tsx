import { lazy, Suspense } from "react";

import { copy } from "./copy";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyAutomationPanel = lazy(() => import("./AutomationPanel"));
type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function WorkspaceAutomationSettings({
  vm,
}: {
  vm: WorkspaceViewModel;
}) {
  if (!vm.detail || !vm.bootstrap) {
    return <p className="settings-empty-state">{copy.narrative.emptyAction}</p>;
  }
  return (
    <Suspense fallback={<div className="context-loading" role="status" />}>
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
  );
}
