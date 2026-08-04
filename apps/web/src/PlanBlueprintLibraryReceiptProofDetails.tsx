import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { PlanBlueprintLibraryReceiptHistoryVerificationDetails } from "./PlanBlueprintLibraryReceiptHistoryVerificationDetails";
import { PlanBlueprintLibraryReceiptProofBundleDetails } from "./PlanBlueprintLibraryReceiptProofBundleDetails";
import { PlanBlueprintLibraryReceiptSignedDetails } from "./PlanBlueprintLibraryReceiptSignedDetails";

export function PlanBlueprintLibraryReceiptProofDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      <PlanBlueprintLibraryReceiptHistoryVerificationDetails
        receipt={receipt}
      />
      <PlanBlueprintLibraryReceiptProofBundleDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptSignedDetails receipt={receipt} />
    </>
  );
}
