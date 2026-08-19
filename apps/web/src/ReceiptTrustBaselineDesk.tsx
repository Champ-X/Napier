import { copy } from "./copy";
import { ReceiptTrustBaselineActions } from "./ReceiptTrustBaselineActions";
import { ReceiptTrustBaselineEvidence } from "./ReceiptTrustBaselineEvidence";
import { ReceiptTrustSelectionActions } from "./ReceiptTrustSelectionActions";
import type { ReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustBaselineDeskProps {
  controller: ReceiptTrustController;
}

export function ReceiptTrustBaselineDesk({
  controller,
}: ReceiptTrustBaselineDeskProps) {
  return (
    <section className="receipt-trust-card receipt-trust-baseline-desk">
      <header>
        <span>
          <strong>{copy.lab.trust.baselineWorkbench}</strong>
          <small>{copy.lab.trust.baselineWorkbenchBody}</small>
        </span>
        <code>
          {controller.projection.baselineActivation.baselineCount
            .toString()
            .padStart(2, "0")}
        </code>
      </header>
      {!controller.projection.latestBaseline ? (
        <p className="receipt-trust-empty-state">
          {copy.lab.trust.baselineWorkbenchEmpty}
        </p>
      ) : null}
      <ReceiptTrustBaselineActions controller={controller} />
      <ReceiptTrustSelectionActions controller={controller} />
      <ReceiptTrustBaselineEvidence controller={controller} />
    </section>
  );
}
