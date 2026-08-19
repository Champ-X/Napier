import { KeyRound, ShieldCheck } from "lucide-react";

import { copy } from "./copy";
import { ReceiptTrustAnchorDesk } from "./ReceiptTrustAnchorDesk";
import { ReceiptTrustBaselineDesk } from "./ReceiptTrustBaselineDesk";
import { ReceiptTrustCheckpointDesk } from "./ReceiptTrustCheckpointDesk";
import { ReceiptTrustDirectoryDesk } from "./ReceiptTrustDirectoryDesk";
import type { ReceiptTrustPanelProps as ReceiptTrustPanelContract } from "./receipt-trust-controller-types";
import "./receipt-trust-evidence.css";
import "./receipt-trust-interactions.css";
import "./receipt-trust-layout.css";
import { ReceiptTrustVerifierDesk } from "./ReceiptTrustVerifierDesk";
import { useReceiptTrustController } from "./use-receipt-trust-controller";

export interface ReceiptTrustPanelProps extends ReceiptTrustPanelContract {}

export default function ReceiptTrustPanel(props: ReceiptTrustPanelProps) {
  const controller = useReceiptTrustController(props);
  return (
    <section
      className="receipt-trust-panel receipt-trust-workbench"
      aria-labelledby="receipt-trust-title"
      aria-busy={Boolean(controller.busyId)}
    >
      <header className="receipt-trust-workbench-header">
        <span>
          <small>{copy.lab.trust.eyebrow}</small>
          <h4 id="receipt-trust-title">{copy.lab.trust.title}</h4>
          <p>{copy.lab.trust.body}</p>
        </span>
        <KeyRound size={20} aria-hidden="true" />
      </header>
      <div className="receipt-trust-workbench-grid">
        <ReceiptTrustAnchorDesk controller={controller} panel={props} />
        <ReceiptTrustVerifierDesk controller={controller} />
        <ReceiptTrustDirectoryDesk controller={controller} />
        <ReceiptTrustBaselineDesk controller={controller} />
        <ReceiptTrustCheckpointDesk controller={controller} />
      </div>
      {controller.error ? (
        <p className="receipt-trust-error" role="alert">
          {controller.error}
        </p>
      ) : null}
      <aside className="receipt-trust-safety">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>{copy.lab.trust.safety}</span>
      </aside>
    </section>
  );
}
