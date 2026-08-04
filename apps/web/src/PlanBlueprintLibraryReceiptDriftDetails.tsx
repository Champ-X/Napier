import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptDriftDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  if (receipt.action !== "policyOverrideDriftReviewed") return null;
  return (
    <>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.portfolioSet}:{" "}
        {receipt.portfolioSetSha256.slice(0, 16)}
        {" / "}
        {planCopy.blueprint.library.overrideSet}:{" "}
        {receipt.overrideSetSha256.slice(0, 16)}
        {" / "}
        {planCopy.blueprint.library.driftReviewSet}:{" "}
        {receipt.reviewSetSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.aligned}:{" "}
        {receipt.alignedCount.toLocaleString()}
        {" / "}
        {planCopy.blueprint.library.recommendedRetire}:{" "}
        {receipt.retireRecommendedCount.toLocaleString()}
        {" / "}
        {planCopy.blueprint.library.missing}:{" "}
        {receipt.missingFamilyCount.toLocaleString()}
      </small>
      {receipt.reviewedFamilySha256 ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.topFamily}:{" "}
          {receipt.reviewedFamilySha256.slice(0, 16)}
          {receipt.reviewedStatus ? ` / ${receipt.reviewedStatus}` : ""}
          {receipt.reviewedRecommendation
            ? ` / ${planCopy.blueprint.library.recommendation}: ${receipt.reviewedRecommendation}`
            : ""}
        </small>
      ) : null}
      {receipt.overridePolicyTemplate || receipt.bestPolicyTemplate ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.overridePolicy}:{" "}
          {receipt.overridePolicyTemplate ?? planCopy.blueprint.library.current}
          {" / "}
          {planCopy.blueprint.library.bestPolicy}:{" "}
          {receipt.bestPolicyTemplate ?? planCopy.blueprint.library.current}
        </small>
      ) : null}
      {receipt.overrideSelectedRecordId || receipt.bestSelectedRecordId ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.override}:{" "}
          {receipt.overrideSelectedRecordId
            ? shortId(receipt.overrideSelectedRecordId)
            : planCopy.blueprint.library.missing}
          {receipt.overrideSelectedRecommendationScoreBps !== undefined
            ? ` / ${(receipt.overrideSelectedRecommendationScoreBps / 100).toFixed(2)}%`
            : ""}
          {" / "}
          {planCopy.blueprint.library.selected}:{" "}
          {receipt.bestSelectedRecordId
            ? shortId(receipt.bestSelectedRecordId)
            : planCopy.blueprint.library.missing}
          {receipt.bestSelectedRecommendationScoreBps !== undefined
            ? ` / ${(receipt.bestSelectedRecommendationScoreBps / 100).toFixed(2)}%`
            : ""}
        </small>
      ) : null}
      <small className="fixture-diagnostics">
        {receipt.reviewedDiagnostics.length > 0
          ? receipt.reviewedDiagnostics.join(", ")
          : planCopy.blueprint.library.noDiagnostics}
      </small>
    </>
  );
}

function shortId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}
