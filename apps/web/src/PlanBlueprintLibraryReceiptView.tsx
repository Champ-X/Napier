import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { projectPlanBlueprintLibraryReceiptHeader } from "./plan-blueprint-library-receipt-model";
import { PlanBlueprintLibraryReceiptCoreDetails } from "./PlanBlueprintLibraryReceiptCoreDetails";
import { PlanBlueprintLibraryReceiptPolicyDetails } from "./PlanBlueprintLibraryReceiptPolicyDetails";

export function PlanBlueprintLibraryReceiptView({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  const header = projectPlanBlueprintLibraryReceiptHeader(receipt);
  return (
    <div
      className={`fixture-receipt status-${header.successful ? "valid" : "invalid"}`}
    >
      <span>{header.title}</span>
      {header.receiptHash ? (
        <code>{header.receiptHash.slice(0, 16)}</code>
      ) : null}
      <small>
        {header.summary}
        {header.identity ? ` / ${header.identity}` : ""}
      </small>
      <PlanBlueprintLibraryReceiptCoreDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptPolicyDetails receipt={receipt} />
    </div>
  );
}
