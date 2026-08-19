import { Download, RefreshCw, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustFileAction } from "./ReceiptTrustFileAction";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustSelectionActionsProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustSelectionActions({
  controller,
}: ReceiptTrustSelectionActionsProps) {
  const { busyId, projection } = controller;
  return (
    <div className="receipt-trust-action-grid">
      <button
        type="button"
        disabled={!projection.canApplyActivationSelection}
        onClick={() => void controller.actions.selection.apply()}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {busyId === "apply-baseline-activation-selection"
          ? copy.lab.trust.applyingBaselineActivation
          : copy.lab.trust.applyBaselineActivation}
      </button>
      <button
        type="button"
        disabled={Boolean(busyId)}
        onClick={() => void controller.actions.selection.refreshDrift()}
      >
        <RefreshCw size={14} aria-hidden="true" />
        {busyId === "refresh-activation-selection-drift"
          ? copy.lab.trust.refreshingActivationSelectionDrift
          : copy.lab.trust.refreshActivationSelectionDrift}
      </button>
      <RotationActions controller={controller} />
      <button
        type="button"
        disabled={Boolean(busyId)}
        onClick={() => void controller.actions.selection.exportHistory()}
      >
        <Download size={14} aria-hidden="true" />
        {busyId === "export-baseline-activation-history"
          ? copy.lab.trust.exportingBaselineActivationHistory
          : copy.lab.trust.exportBaselineActivationHistory}
      </button>
      <ReceiptTrustFileAction
        disabled={Boolean(busyId)}
        label={
          busyId === "verify-baseline-activation-history"
            ? copy.lab.trust.verifyingBaselineActivationHistory
            : copy.lab.trust.verifyBaselineActivationHistory
        }
        onFile={(file) =>
          void controller.actions.selection.verifyHistoryFile(file)
        }
      />
    </div>
  );
}

function RotationActions({
  controller,
}: {
  controller: ReceiptTrustController;
}) {
  const { busyId, projection } = controller;
  const actions = [
    {
      id: "review-activation-selection-rotation",
      label: copy.lab.trust.reviewActivationSelectionRotation,
      busy: copy.lab.trust.reviewingActivationSelectionRotation,
      enabled: projection.canReviewActivationSelectionRotation,
      run: controller.actions.rotation.review,
    },
    {
      id: "propose-activation-selection-rotation",
      label: copy.lab.trust.proposeActivationSelectionRotation,
      busy: copy.lab.trust.proposingActivationSelectionRotation,
      enabled: projection.canReviewActivationSelectionRotation,
      run: controller.actions.rotation.propose,
    },
    {
      id: "sign-activation-selection-rotation-proposal",
      label: copy.lab.trust.signActivationSelectionRotationProposal,
      busy: copy.lab.trust.signingActivationSelectionRotationProposal,
      enabled: projection.canSignActivationSelectionRotationProposal,
      run: controller.actions.rotation.sign,
    },
    {
      id: "preflight-activation-selection-rotation-proposal",
      label: copy.lab.trust.preflightActivationSelectionRotationProposal,
      busy: copy.lab.trust.preflightingActivationSelectionRotationProposal,
      enabled: projection.canPreflightActivationSelectionRotationProposal,
      run: controller.actions.rotation.preflight,
    },
  ];
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          aria-busy={busyId === action.id}
          onClick={() => void action.run()}
        >
          <ShieldCheck size={14} aria-hidden="true" />
          {busyId === action.id ? action.busy : action.label}
        </button>
      ))}
    </>
  );
}
