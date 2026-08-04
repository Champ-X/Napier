import type { PlanArtifactLedgerEventReceipt } from "./artifact-file-api";
import { planCopy } from "./plan-copy";

export function PlanArtifactLedgerReceiptLine({
  receipt,
}: {
  receipt: PlanArtifactLedgerEventReceipt;
}) {
  return (
    <small>
      {planCopy.receipt}:{" "}
      <code title={receipt.ledgerEventId}>
        #{String(receipt.ledgerEventSeq).padStart(3, "0")}
      </code>
      {" / "}
      <code title={receipt.ledgerEventSha256}>
        {receipt.ledgerEventSha256.slice(0, 16)}
      </code>
    </small>
  );
}
