import {
  getExecutionPlanBlueprintPortfolioCalibration,
  getExecutionPlanBlueprintRecommendationPolicyBacktest,
  selectExecutionPlanBlueprintRecord,
  setExecutionPlanBlueprintRecommendationPolicyOverride,
} from "./api";
import type { PlanBlueprintLibraryCardActions } from "./PlanBlueprintLibraryCard";
import {
  planBlueprintPortfolioCalibrationReceipt,
  planBlueprintRecommendationPolicyBacktestReceipt,
  planBlueprintRecommendationPolicyOverrideReceipt,
  planBlueprintSelectionReceipt,
} from "./plan-blueprint-library-view-model";
import type { PlanBlueprintLibraryActionContext } from "./plan-blueprint-library-controller-types";
import { runBlueprintLibraryAction } from "./plan-blueprint-library-controller-types";

type PortfolioActions = Pick<
  PlanBlueprintLibraryCardActions,
  "onSelect" | "onCalibrate" | "onBacktestPolicy" | "onApplyPolicyOverride"
>;

export function createPlanBlueprintPortfolioActions(
  context: PlanBlueprintLibraryActionContext,
): PortfolioActions {
  const onSelect = (): void => {
    if (!context.threadId) return;
    void runBlueprintLibraryAction(
      context,
      "select",
      () => selectExecutionPlanBlueprintRecord(context.threadId!),
      (result) => ({ receipt: planBlueprintSelectionReceipt(result) }),
    );
  };

  const onCalibrate = (): void => {
    void runBlueprintLibraryAction(
      context,
      "calibratePortfolio",
      getExecutionPlanBlueprintPortfolioCalibration,
      (result) => ({
        receipt: planBlueprintPortfolioCalibrationReceipt(result),
      }),
    );
  };

  const onBacktestPolicy = (): void => {
    void runBlueprintLibraryAction(
      context,
      "backtestPolicy",
      getExecutionPlanBlueprintRecommendationPolicyBacktest,
      (result) => ({
        receipt: planBlueprintRecommendationPolicyBacktestReceipt(result),
      }),
    );
  };

  const onApplyPolicyOverride = (): void => {
    const receipt = context.state.receipt;
    if (
      receipt?.action !== "policyBacktested" ||
      !receipt.topSelectedFamilySha256
    ) {
      return;
    }
    void runBlueprintLibraryAction(
      context,
      "applyPolicyOverride",
      () =>
        setExecutionPlanBlueprintRecommendationPolicyOverride({
          familySha256: receipt.topSelectedFamilySha256!,
          policyTemplate: receipt.topPolicyTemplate,
          expectedPortfolioSetSha256: receipt.portfolioSetSha256,
        }),
      (result) => ({
        receipt: planBlueprintRecommendationPolicyOverrideReceipt(result),
      }),
      { preserveReceipt: true },
    );
  };

  return { onSelect, onCalibrate, onBacktestPolicy, onApplyPolicyOverride };
}
