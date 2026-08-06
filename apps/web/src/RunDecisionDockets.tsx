import { lazy, Suspense } from "react";

import { BrowserLiveViewPanel } from "./BrowserLiveViewPanel";
import { browserLiveViewExpected } from "./browser-live-view-state";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyOperatorDecisionPanel = lazy(() => import("./OperatorDecisionPanel"));
const LazyBrowserInteractionConfirmationPanel = lazy(
  () => import("./BrowserInteractionConfirmationPanel"),
);

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function RunDecisionDockets({
  vm,
}: {
  vm: Pick<
    WorkspaceViewModel,
    | "answerOperatorDecision"
    | "activeRunId"
    | "browserInteractionConfirmation"
    | "browserInteractionConfirmationBusy"
    | "cancelOperatorDecision"
    | "continueOperatorDecision"
    | "decideBrowserInteractionConfirmation"
    | "openOperatorDecision"
    | "openOperatorDecisionWorkflowOwned"
    | "operatorDecisionBusy"
    | "detail"
  >;
}) {
  const showBrowserLive =
    vm.activeRunId !== undefined &&
    vm.detail !== undefined &&
    browserLiveViewExpected(vm.detail.events, vm.activeRunId);
  if (
    !showBrowserLive &&
    !vm.openOperatorDecision &&
    !vm.browserInteractionConfirmation
  ) {
    return null;
  }
  return (
    <div className="run-decision-dockets">
      {showBrowserLive ? (
        <BrowserLiveViewPanel
          threadId={vm.detail!.thread.id}
          runId={vm.activeRunId!}
          events={vm.detail!.events}
          {...(vm.browserInteractionConfirmation
            ? {
                confirmationAction: vm.browserInteractionConfirmation.action,
              }
            : {})}
        />
      ) : null}
      {vm.openOperatorDecision ? (
        <Suspense fallback={null}>
          <LazyOperatorDecisionPanel
            decision={vm.openOperatorDecision}
            workflowOwned={vm.openOperatorDecisionWorkflowOwned}
            busy={vm.operatorDecisionBusy}
            onAnswer={vm.answerOperatorDecision}
            onContinue={vm.continueOperatorDecision}
            onCancel={vm.cancelOperatorDecision}
          />
        </Suspense>
      ) : null}
      {vm.browserInteractionConfirmation ? (
        <Suspense fallback={null}>
          <LazyBrowserInteractionConfirmationPanel
            confirmation={vm.browserInteractionConfirmation}
            busy={vm.browserInteractionConfirmationBusy}
            onDecision={vm.decideBrowserInteractionConfirmation}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
