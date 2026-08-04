import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { PlanBlueprintLibraryReceiptHistoryDetails } from "./PlanBlueprintLibraryReceiptHistoryDetails";
import { PlanBlueprintLibraryReceiptReplayOutcomeDetails } from "./PlanBlueprintLibraryReceiptReplayOutcomeDetails";

export function PlanBlueprintLibraryReceiptReplayDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      <PlanBlueprintLibraryReceiptHistoryDetails receipt={receipt} />
      <PlanBlueprintLibraryReceiptReplayOutcomeDetails receipt={receipt} />
    </>
  );
}
