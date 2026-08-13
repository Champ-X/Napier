import { lazy, Suspense } from "react";

import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyWorkbenchNotices = lazy(() => import("./WorkbenchNotices"));
const LazyRunDecisionDockets = lazy(() => import("./RunDecisionDockets"));

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

export function WorkbenchDeferredDecisions({
  vm,
  browserControlsAvailable,
}: {
  vm: WorkspaceViewModel;
  browserControlsAvailable: boolean;
}) {
  const showDecisions = Boolean(
    browserControlsAvailable ||
    vm.openOperatorDecision ||
    vm.browserInteractionConfirmation,
  );
  return showDecisions ? (
    <Suspense fallback={null}>
      <LazyRunDecisionDockets vm={vm} />
    </Suspense>
  ) : null;
}
