import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptSelectionDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "selection" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.selectionSet}:{" "}
            {receipt.selectionSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.familyPolicyOverrideSetSha256.slice(0, 16)}
            {receipt.selectedPreviewSha256
              ? ` / ${planCopy.blueprint.library.latestPreview}: ${receipt.selectedPreviewSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.selectedRecommendationPolicyTemplate ??
              receipt.recommendationPolicyTemplate}
            {" / "}
            {(
              receipt.selectedRecommendationPolicySha256 ??
              receipt.recommendationPolicySha256
            ).slice(0, 16)}
            {receipt.selectedRecommendationPolicySource
              ? ` / ${planCopy.blueprint.library.policySource}: ${receipt.selectedRecommendationPolicySource}`
              : ""}
            {receipt.selectedFamilyPolicyOverrideSha256
              ? ` / ${planCopy.blueprint.library.override}: ${receipt.selectedFamilyPolicyOverrideSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {receipt.selectedRecordId
              ? `${planCopy.blueprint.library.selected}: ${shortId(receipt.selectedRecordId)}`
              : receipt.diagnostics.length > 0
                ? receipt.diagnostics.join(", ")
                : planCopy.blueprint.library.noDiagnostics}
            {receipt.selectedBaselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.selectedBaselineSha256.slice(0, 16)}`
              : ""}
            {receipt.selectedFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.selectedFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          {receipt.selectedScoreBps !== undefined ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.score}:{" "}
              {(receipt.selectedScoreBps / 100).toFixed(2)}%{" / "}
              {planCopy.blueprint.library.replays}:{" "}
              {(receipt.selectedReplayCount ?? 0).toLocaleString()}
              {receipt.selectedRecommendationScoreBps !== undefined
                ? ` / ${planCopy.blueprint.library.recommendation}: ${(receipt.selectedRecommendationScoreBps / 100).toFixed(2)}%`
                : ""}
              {receipt.selectedFamilyCompletionRateBps !== undefined
                ? ` / ${planCopy.blueprint.library.families}: ${(receipt.selectedFamilyCompletionRateBps / 100).toFixed(2)}%`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "portfolioCalibrated" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {receipt.topFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.topFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.active}:{" "}
            {receipt.activeCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.archived}:{" "}
            {receipt.archivedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.reviewed}:{" "}
            {receipt.reviewedBaselineCount.toLocaleString()}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.missing}:{" "}
            {receipt.missingBaselineCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.policyFailed}:{" "}
            {receipt.policyFailedCount.toLocaleString()}
            {receipt.topRecordScoreBps !== undefined
              ? ` / ${planCopy.blueprint.library.score}: ${(receipt.topRecordScoreBps / 100).toFixed(2)}%`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "policyBacktested" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.policySet}:{" "}
            {receipt.policySetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.topPolicyTemplate}
            {receipt.topPolicySha256
              ? ` / ${receipt.topPolicySha256.slice(0, 16)}`
              : ""}
            {receipt.topSelectedFamilySha256
              ? ` / ${planCopy.blueprint.library.topFamily}: ${receipt.topSelectedFamilySha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.active}:{" "}
            {receipt.activeCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.divergent}:{" "}
            {receipt.divergentSelectionCount.toLocaleString()}
            {receipt.topSelectedRecommendationScoreBps !== undefined
              ? ` / ${planCopy.blueprint.library.recommendation}: ${(receipt.topSelectedRecommendationScoreBps / 100).toFixed(2)}%`
              : ""}
            {" / "}
            {planCopy.blueprint.library.average}:{" "}
            {(receipt.averageRecommendationScoreBps / 100).toFixed(2)}%
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideApplied" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.topFamily}:{" "}
            {receipt.familySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.recommendationPolicyTemplate}
            {" / "}
            {receipt.recommendationPolicySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.qualified}:{" "}
            {receipt.familyOutcomeQualifiedCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.familyCompletionRateBps / 100).toFixed(2)}%
          </small>
        </>
      ) : null}
    </>
  );
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
