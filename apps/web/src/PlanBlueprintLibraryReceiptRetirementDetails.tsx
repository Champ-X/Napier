import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptRetirementDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "policyOverrideRetired" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.topFamily}:{" "}
            {receipt.familySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.retired}:{" "}
            {receipt.retiredOverrideSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.recommendationPolicy}:{" "}
            {receipt.retiredRecommendationPolicyTemplate}
            {" / "}
            {receipt.retiredRecommendationPolicySha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.overrideSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.driftReviewSet}:{" "}
            {receipt.driftReviewSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.remaining}:{" "}
            {receipt.remainingOverrideSetSha256.slice(0, 16)}
          </small>
        </>
      ) : null}
      {receipt.action === "policyOverrideRetirements" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.portfolioSet}:{" "}
            {receipt.portfolioSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.overrideSet}:{" "}
            {receipt.currentOverrideSetSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.retirementSetSha256.slice(0, 16)}
          </small>
          {receipt.latestFamilySha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.latest}:{" "}
              {receipt.latestFamilySha256.slice(0, 16)}
              {receipt.latestRetiredOverrideSha256
                ? ` / ${planCopy.blueprint.library.retired}: ${receipt.latestRetiredOverrideSha256.slice(0, 16)}`
                : ""}
              {receipt.latestRetiredRecommendationPolicyTemplate
                ? ` / ${planCopy.blueprint.library.recommendationPolicy}: ${receipt.latestRetiredRecommendationPolicyTemplate}`
                : ""}
            </small>
          ) : null}
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.latest}:{" "}
            {receipt.latestRetiredAt ?? planCopy.blueprint.library.missing}
            {receipt.latestRemainingOverrideSetSha256
              ? ` / ${planCopy.blueprint.library.remaining}: ${receipt.latestRemainingOverrideSetSha256.slice(0, 16)}`
              : ""}
          </small>
        </>
      ) : null}
    </>
  );
}
