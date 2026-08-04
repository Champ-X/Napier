import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export interface PlanBlueprintLibraryReceiptHeader {
  successful: boolean;
  title: string;
  receiptHash: string | undefined;
  summary: string;
  identity: string | undefined;
}

export function projectPlanBlueprintLibraryReceiptHeader(
  receipt: PlanBlueprintLibraryReceipt,
): PlanBlueprintLibraryReceiptHeader {
  return {
    successful: receiptSuccessful(receipt),
    title: receiptTitle(receipt),
    receiptHash: receiptHash(receipt),
    summary: receiptSummary(receipt),
    identity: receiptIdentity(receipt),
  };
}

function receiptSuccessful(receipt: PlanBlueprintLibraryReceipt): boolean {
  switch (receipt.action) {
    case "qualified":
      return receipt.qualificationStatus === "qualified";
    case "previewed":
      return receipt.previewStatus === "ready";
    case "historyVerified":
    case "outcomesVerified":
      return receipt.verificationStatus === "valid";
    case "outcomeQualified":
      return receipt.qualificationStatus === "qualified";
    case "outcomeReviewed":
      return receipt.verdict === "promote";
    case "selection":
      return Boolean(receipt.selectedRecordId);
    case "policyOverrideDriftReviewed":
      return (
        receipt.retireRecommendedCount === 0 && receipt.missingFamilyCount === 0
      );
    case "policyOverrideRetirementsVerified":
      return receipt.verificationStatus === "valid";
    case "policyOverrideRetirementProofBundle":
      return receipt.verificationStatus === "aligned";
    case "policyOverrideRetirementProofBundleSigned":
      return receipt.verificationStatus !== "invalid";
    case "created":
      return receipt.replayEventVerificationStatus
        ? receipt.replayEventVerificationStatus === "valid"
        : !receipt.replayEventDiagnostics;
    default:
      return true;
  }
}

function receiptTitle(receipt: PlanBlueprintLibraryReceipt): string {
  switch (receipt.action) {
    case "qualified":
      return planCopy.blueprint.library.qualificationStatuses[
        receipt.qualificationStatus
      ];
    case "previewed":
      return planCopy.blueprint.library.previewStatuses[receipt.previewStatus];
    case "historyVerified":
      return planCopy.blueprint.library.verificationStatuses[
        receipt.verificationStatus
      ];
    case "outcomesVerified":
      return planCopy.blueprint.library.outcomeVerificationStatuses[
        receipt.verificationStatus
      ];
    case "outcomeQualified":
      return planCopy.blueprint.library.outcomeQualificationStatuses[
        receipt.qualificationStatus
      ];
    case "outcomeReviewed":
      return planCopy.blueprint.library.outcomeReviewVerdicts[receipt.verdict];
    case "selection":
    case "portfolioCalibrated":
    case "policyBacktested":
    case "policyOverrideApplied":
    case "policyOverrideDriftReviewed":
    case "policyOverrideRetired":
    case "policyOverrideRetirements":
    case "policyOverrideRetirementsVerified":
    case "policyOverrideRetirementProofBundle":
    case "policyOverrideRetirementProofBundleSigned":
      return planCopy.blueprint.library.receipts[receipt.action];
    default:
      return planCopy.blueprint.library.receipts[receipt.action];
  }
}

function receiptHash(receipt: PlanBlueprintLibraryReceipt): string | undefined {
  if ("blueprintSha256" in receipt) return receipt.blueprintSha256;
  switch (receipt.action) {
    case "history":
    case "historyVerified":
    case "outcomes":
    case "outcomesVerified":
    case "selection":
    case "portfolioCalibrated":
    case "policyBacktested":
    case "policyOverrideApplied":
    case "policyOverrideDriftReviewed":
    case "policyOverrideRetired":
    case "policyOverrideRetirements":
    case "policyOverrideRetirementsVerified":
    case "policyOverrideRetirementProofBundle":
    case "policyOverrideRetirementProofBundleSigned":
    case "outcomeQualified":
      return receipt.contentSha256;
    case "outcomeBaseline":
      return receipt.baselineSha256;
    case "outcomeReviewed":
      return receipt.reviewSha256;
    default:
      return undefined;
  }
}

function receiptSummary(receipt: PlanBlueprintLibraryReceipt): string {
  switch (receipt.action) {
    case "history":
    case "historyVerified":
      return `${receipt.replayCount.toLocaleString()} ${planCopy.blueprint.library.replays} / ${receipt.threadCount.toLocaleString()} ${planCopy.blueprint.library.threads} / ${receipt.planCount.toLocaleString()} ${planCopy.blueprint.library.plans}`;
    case "outcomes":
    case "outcomesVerified":
    case "outcomeBaseline":
    case "outcomeReviewed":
    case "outcomeQualified":
      return `${receipt.replayCount.toLocaleString()} ${planCopy.blueprint.library.replays} / ${receipt.completedCount.toLocaleString()} ${planCopy.blueprint.library.completed} / ${receipt.blockedCount.toLocaleString()} ${planCopy.blueprint.library.blocked} / ${receipt.invalidCount.toLocaleString()} ${planCopy.blueprint.library.invalid}`;
    case "selection":
      return `${receipt.candidateCount.toLocaleString()} ${planCopy.blueprint.library.candidates} / ${receipt.qualifiedCandidateCount.toLocaleString()} ${planCopy.blueprint.library.qualified} / ${receipt.rejectedCandidateCount.toLocaleString()} ${planCopy.blueprint.library.rejected}`;
    case "portfolioCalibrated":
      return `${receipt.recordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.familyCount.toLocaleString()} ${planCopy.blueprint.library.families} / ${receipt.outcomeQualifiedCount.toLocaleString()} ${planCopy.blueprint.library.qualified}`;
    case "policyBacktested":
      return `${receipt.policyCount.toLocaleString()} ${planCopy.blueprint.library.policies} / ${receipt.recordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.divergentSelectionCount.toLocaleString()} ${planCopy.blueprint.library.divergent}`;
    case "policyOverrideApplied":
      return `${receipt.familyRecordCount.toLocaleString()} ${planCopy.blueprint.library.records} / ${receipt.familyOutcomeQualifiedCount.toLocaleString()} ${planCopy.blueprint.library.qualified} / ${planCopy.blueprint.library.recommendationPolicy}: ${receipt.recommendationPolicyTemplate}`;
    case "policyOverrideDriftReviewed":
      return `${receipt.overrideCount.toLocaleString()} ${planCopy.blueprint.library.override} / ${receipt.alignedCount.toLocaleString()} ${planCopy.blueprint.library.aligned} / ${receipt.retireRecommendedCount.toLocaleString()} ${planCopy.blueprint.library.recommendedRetire}`;
    case "policyOverrideRetired":
      return `${planCopy.blueprint.library.retired}: ${receipt.retiredRecommendationPolicyTemplate} / ${planCopy.blueprint.library.remaining}: ${receipt.remainingOverrideSetSha256.slice(0, 12)}`;
    case "policyOverrideRetirements":
      return `${receipt.retirementCount.toLocaleString()} ${planCopy.blueprint.library.retired} / ${planCopy.blueprint.library.retirementSet}: ${receipt.retirementSetSha256.slice(0, 12)}`;
    case "policyOverrideRetirementsVerified":
      return `${receipt.observedRetirementCount.toLocaleString()} ${planCopy.blueprint.library.retired} / ${planCopy.blueprint.library.retirementSet}: ${receipt.observedRetirementSetSha256.slice(0, 12)}`;
    case "policyOverrideRetirementProofBundle":
      return `${receipt.validHistoryCount.toLocaleString()} ${planCopy.blueprint.library.valid} / ${receipt.invalidHistoryCount.toLocaleString()} ${planCopy.blueprint.library.invalid} / ${planCopy.blueprint.library.retirementSet}: ${receipt.distinctRetirementSetCount.toLocaleString()}`;
    case "policyOverrideRetirementProofBundleSigned":
      return `${receipt.historyCount.toLocaleString()} ${planCopy.blueprint.library.histories} / ${planCopy.blueprint.library.signer}: ${receipt.keyId.slice(0, 12)} / ${planCopy.blueprint.library.receipt}: ${receipt.receiptContentSha256.slice(0, 12)}`;
    default:
      return `${receipt.stepCount.toLocaleString()} ${planCopy.blueprint.steps} / ${receipt.artifactCount.toLocaleString()} ${planCopy.blueprint.artifacts}`;
  }
}

function receiptIdentity(
  receipt: PlanBlueprintLibraryReceipt,
): string | undefined {
  switch (receipt.action) {
    case "qualified":
      return shortId(receipt.recordId);
    case "previewed":
      return shortId(receipt.planId ?? receipt.recordId);
    case "history":
    case "outcomes":
      return shortId(receipt.latestPlanId ?? receipt.recordId);
    case "outcomeBaseline":
      return shortId(receipt.baselineId);
    case "outcomeReviewed":
      return shortId(receipt.recordId);
    case "selection":
      return shortId(receipt.selectedRecordId ?? receipt.threadId);
    case "portfolioCalibrated":
      return receipt.topRecordId
        ? shortId(receipt.topRecordId)
        : receipt.topFamilySha256?.slice(0, 12);
    case "policyBacktested":
      return receipt.topSelectedRecordId
        ? shortId(receipt.topSelectedRecordId)
        : receipt.topSelectedFamilySha256?.slice(0, 12);
    case "policyOverrideApplied":
      return receipt.familySha256.slice(0, 12);
    case "historyVerified":
    case "outcomesVerified":
    case "outcomeQualified":
      return receipt.recordId ? shortId(receipt.recordId) : undefined;
    default:
      return policyOrBasicReceiptIdentity(receipt);
  }
}

function policyOrBasicReceiptIdentity(
  receipt: PlanBlueprintLibraryReceipt,
): string | undefined {
  switch (receipt.action) {
    case "policyOverrideDriftReviewed":
      return (
        receipt.reviewedFamilySha256?.slice(0, 12) ??
        receipt.reviewSetSha256.slice(0, 12)
      );
    case "policyOverrideRetired":
      return receipt.familySha256.slice(0, 12);
    case "policyOverrideRetirements":
      return (
        receipt.latestFamilySha256?.slice(0, 12) ??
        receipt.retirementSetSha256.slice(0, 12)
      );
    case "policyOverrideRetirementsVerified":
      return receipt.observedRetirementSetSha256.slice(0, 12);
    case "policyOverrideRetirementProofBundle":
      return receipt.retirementSetBundleSha256.slice(0, 12);
    case "policyOverrideRetirementProofBundleSigned":
      return receipt.keyId.slice(0, 12);
    default:
      if ("status" in receipt) {
        return planCopy.blueprint.library.statuses[receipt.status];
      }
      return "planId" in receipt && typeof receipt.planId === "string"
        ? shortId(receipt.planId)
        : undefined;
  }
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
