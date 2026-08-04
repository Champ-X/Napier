import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { PlanBlueprintLibraryReceiptDriftDetails } from "./PlanBlueprintLibraryReceiptDriftDetails";
import { PlanBlueprintLibraryReceiptProofDetails } from "./PlanBlueprintLibraryReceiptProofDetails";
import { PlanBlueprintLibraryReceiptRetirementDetails } from "./PlanBlueprintLibraryReceiptRetirementDetails";

export function PlanBlueprintLibraryReceiptPolicyDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      <PlanBlueprintLibraryReceiptDriftDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptRetirementDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptProofDetails receipt={receipt} />
    </>
  );
}
