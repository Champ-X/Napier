import { lazy, Suspense } from "react";

import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyOperatorDecisionPanel = lazy(() => import("./OperatorDecisionPanel"));
const LazyBrowserInteractionConfirmationPanel = lazy(() =>
  import("./BrowserInteractionConfirmationPanel").then(
    ({ BrowserInteractionConfirmationPanel }) => ({
      default: BrowserInteractionConfirmationPanel,
    }),
  ),
);

type WorkspaceViewModel = ReturnType<typeof useWorkspaceViewModel>;

export function RunDecisionDockets({
  vm,
}: {
  vm: Pick<
    WorkspaceViewModel,
    | "answerOperatorDecision"
    | "browserInteractionConfirmation"
    | "browserInteractionConfirmationBusy"
    | "cancelOperatorDecision"
    | "continueOperatorDecision"
    | "decideBrowserInteractionConfirmation"
    | "openOperatorDecision"
    | "openOperatorDecisionWorkflowOwned"
    | "operatorDecisionBusy"
  >;
}) {
  if (!vm.openOperatorDecision && !vm.browserInteractionConfirmation) {
    return null;
  }
  return (
    <div className="run-decision-dockets">
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
