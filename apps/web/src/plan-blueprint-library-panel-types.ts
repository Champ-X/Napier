import type { ExecutionPlanBlueprintRecord } from "@napier/contracts";

import type {
  PlanBlueprintLibraryCreatedReceipt,
  PlanBlueprintLibraryOutcomeBaselineReceipt,
  PlanBlueprintLibraryOutcomeQualificationReceipt,
  PlanBlueprintLibraryOutcomeReviewReceipt,
  PlanBlueprintLibraryPortfolioCalibrationReceipt,
  PlanBlueprintLibraryPreviewReceipt,
  PlanBlueprintLibraryQualificationReceipt,
  PlanBlueprintLibraryRecommendationPolicyBacktestReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt,
  PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt,
  PlanBlueprintLibraryReplayHistoryReceipt,
  PlanBlueprintLibraryReplayHistoryVerificationReceipt,
  PlanBlueprintLibraryReplayOutcomesReceipt,
  PlanBlueprintLibraryReplayOutcomesVerificationReceipt,
  PlanBlueprintLibrarySelectionReceipt,
} from "./plan-blueprint-library-view-model";

export type PlanBlueprintLibraryBusyAction =
  | "load"
  | "save"
  | "status"
  | "create"
  | "qualify"
  | "preview"
  | "history"
  | "verifyHistory"
  | "outcomes"
  | "verifyOutcomes"
  | "promoteOutcomeBaseline"
  | "promoteReviewedOutcomeBaseline"
  | "qualifyOutcomes"
  | "reviewOutcomes"
  | "calibratePortfolio"
  | "backtestPolicy"
  | "applyPolicyOverride"
  | "reviewPolicyOverrideDrift"
  | "retirePolicyOverride"
  | "auditPolicyOverrideRetirements"
  | "verifyPolicyOverrideRetirements"
  | "verifyPolicyOverrideRetirementProofBundle"
  | "signPolicyOverrideRetirementProofBundle"
  | "select";

export type PlanBlueprintLibraryReceipt =
  | {
      action: "saved" | "reused" | "archived" | "restored";
      recordId: string;
      blueprintSha256: string;
      status: ExecutionPlanBlueprintRecord["status"];
      stepCount: number;
      artifactCount: number;
    }
  | PlanBlueprintLibraryCreatedReceipt
  | PlanBlueprintLibraryQualificationReceipt
  | PlanBlueprintLibraryPreviewReceipt
  | PlanBlueprintLibraryReplayHistoryReceipt
  | PlanBlueprintLibraryReplayHistoryVerificationReceipt
  | PlanBlueprintLibraryReplayOutcomesReceipt
  | PlanBlueprintLibraryReplayOutcomesVerificationReceipt
  | PlanBlueprintLibraryOutcomeBaselineReceipt
  | PlanBlueprintLibraryOutcomeQualificationReceipt
  | PlanBlueprintLibraryOutcomeReviewReceipt
  | PlanBlueprintLibraryPortfolioCalibrationReceipt
  | PlanBlueprintLibraryRecommendationPolicyBacktestReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideDriftReviewReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementHistoryVerificationReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleReceipt
  | PlanBlueprintLibraryRecommendationPolicyOverrideRetirementProofBundleSignedReceipt
  | PlanBlueprintLibrarySelectionReceipt;
