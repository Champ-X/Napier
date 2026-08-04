import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { PlanBlueprintLibraryReceiptOutcomeDetails } from "./PlanBlueprintLibraryReceiptOutcomeDetails";
import { PlanBlueprintLibraryReceiptReplayDetails } from "./PlanBlueprintLibraryReceiptReplayDetails";
import { PlanBlueprintLibraryReceiptSelectionDetails } from "./PlanBlueprintLibraryReceiptSelectionDetails";

export function PlanBlueprintLibraryReceiptCoreDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      <PlanBlueprintLibraryReceiptReplayDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptOutcomeDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptSelectionDetails receipt={receipt} />
    </>
  );
}
