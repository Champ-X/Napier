import { ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustFileAction } from "./ReceiptTrustFileAction";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustBaselineActionsProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustBaselineActions({
  controller,
}: ReceiptTrustBaselineActionsProps) {
  const { busyId, projection } = controller;
  return (
    <div className="receipt-trust-action-bar">
      <button
        type="button"
        disabled={!projection.latestBaseline || Boolean(busyId)}
        aria-busy={busyId === "verify-quorum-baseline"}
        onClick={() => void controller.actions.baseline.verifyLatest()}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {busyId === "verify-quorum-baseline"
          ? copy.lab.trust.verifyingBaseline
          : copy.lab.trust.verifyBaseline}
      </button>
      <ReceiptTrustFileAction
        disabled={Boolean(busyId)}
        label={
          busyId === "import-quorum-baseline"
            ? copy.lab.trust.importingBaseline
            : copy.lab.trust.importBaseline
        }
        onFile={(file) => void controller.actions.baseline.importFile(file)}
      />
      <button
        className="receipt-trust-primary-action"
        type="button"
        disabled={!projection.canSignActivationDecision}
        aria-busy={busyId === "sign-quorum-baseline-activation"}
        onClick={() => void controller.actions.baseline.signActivation()}
      >
        <ShieldCheck size={14} aria-hidden="true" />
        {busyId === "sign-quorum-baseline-activation"
          ? copy.lab.trust.signingBaselineActivation
          : copy.lab.trust.signBaselineActivation}
      </button>
    </div>
  );
}
