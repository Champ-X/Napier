import { lazy, Suspense } from "react";

import type { useWorkspaceViewModel } from "./use-workspace-view-model";
import { taskArtifactPaths } from "./task-completion-output-paths";
import { taskNarrative } from "./task-narrative-view-model";

const LazyWorkbenchNotices = lazy(() =>
  import("./WorkbenchNotices").then(({ WorkbenchNotices }) => ({
    default: WorkbenchNotices,
  })),
);
const LazyRunDecisionDockets = lazy(() =>
  import("./RunDecisionDockets").then(({ RunDecisionDockets }) => ({
    default: RunDecisionDockets,
  })),
);
const LazyTaskCompletionSummary = lazy(() => import("./TaskCompletionSummary"));

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function WorkbenchDeferredNotices({ vm }: { vm: WorkspaceViewModel }) {
  const showNotices = Boolean(vm.error || vm.resumableRun);
  return showNotices ? (
    <Suspense fallback={null}>
      <LazyWorkbenchNotices
        error={vm.error}
        resumableRun={vm.resumableRun}
        running={vm.isRunning}
        modelConfigured={vm.selectedModel.configured}
        onResume={() => void vm.resume()}
      />
    </Suspense>
  ) : null;
}

/** Keeps completed outputs reachable when the desktop workspace rail is hidden. */
export function WorkbenchDeferredCompactTaskResult({
  vm,
  onOpenArtifact,
  suppressed = false,
}: {
  vm: WorkspaceViewModel;
  onOpenArtifact(path: string): void;
  suppressed?: boolean;
}) {
  if (suppressed) return null;
  if (!vm.detail) return null;
  const narrative = taskNarrative(vm.detail);
  if (narrative.phase !== "completed") return null;
  const outputPaths = taskArtifactPaths(vm.detail.plans, vm.detail.activePlan);
  if (narrative.completedItems.length === 0 && outputPaths.length === 0)
    return null;
  return (
    <div className="task-result-summary is-compact-only">
      <Suspense fallback={null}>
        <LazyTaskCompletionSummary
          completedItems={narrative.completedItems}
          plans={vm.detail.plans}
          activePlan={vm.detail.activePlan}
          threadId={vm.detail.thread.id}
          onLedgerChanged={vm.refreshActiveThread}
          onOpenArtifact={onOpenArtifact}
        />
      </Suspense>
    </div>
  );
}

export function WorkbenchDeferredDecisions({ vm }: { vm: WorkspaceViewModel }) {
  const showDecisions = Boolean(
    vm.openOperatorDecision || vm.browserInteractionConfirmation,
  );
  return showDecisions ? (
    <Suspense fallback={null}>
      <LazyRunDecisionDockets vm={vm} />
    </Suspense>
  ) : null;
}
