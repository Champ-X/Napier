import { lazy, Suspense } from "react";

import { BrowserInteractionConfirmationPanel } from "./BrowserInteractionConfirmationPanel";
import type { useWorkspaceViewModel } from "./use-workspace-view-model";

const LazyOperatorDecisionPanel = lazy(() => import("./OperatorDecisionPanel"));

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
  return (
    <>
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
        <BrowserInteractionConfirmationPanel
          confirmation={vm.browserInteractionConfirmation}
          busy={vm.browserInteractionConfirmationBusy}
          onDecision={vm.decideBrowserInteractionConfirmation}
        />
      ) : null}
    </>
  );
}
