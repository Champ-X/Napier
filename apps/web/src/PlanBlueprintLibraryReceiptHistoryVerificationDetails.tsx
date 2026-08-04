import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptHistoryVerificationDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  if (receipt.action !== "policyOverrideRetirementsVerified") return null;
  return (
    <>
      <small className="fixture-diagnostics">
        {receipt.diagnostics.length > 0
          ? receipt.diagnostics.join(", ")
          : planCopy.blueprint.library.noDiagnostics}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.declared}:{" "}
        {receipt.declaredContentSha256?.slice(0, 16) ?? "missing"}
        {receipt.observedContentSha256
          ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedContentSha256.slice(0, 16)}`
          : ""}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.portfolioSet}:{" "}
        {receipt.declaredPortfolioSetSha256?.slice(0, 16) ?? "missing"}
        {" / "}
        {planCopy.blueprint.library.observed}:{" "}
        {receipt.observedPortfolioSetSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.overrideSet}:{" "}
        {receipt.declaredCurrentOverrideSetSha256?.slice(0, 16) ?? "missing"}
        {" / "}
        {planCopy.blueprint.library.observed}:{" "}
        {receipt.observedCurrentOverrideSetSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.retirementSet}:{" "}
        {receipt.declaredRetirementSetSha256?.slice(0, 16) ?? "missing"}
        {receipt.recomputedRetirementSetSha256
          ? ` / ${planCopy.blueprint.library.actual}: ${receipt.recomputedRetirementSetSha256.slice(0, 16)}`
          : ""}
        {" / "}
        {planCopy.blueprint.library.observed}:{" "}
        {receipt.observedRetirementSetSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.retired}:{" "}
        {receipt.retirementCount.toLocaleString()}
        {" / "}
        {planCopy.blueprint.library.observed}:{" "}
        {receipt.observedRetirementCount.toLocaleString()}
        {receipt.latestRetiredAt || receipt.observedLatestRetiredAt
          ? ` / ${planCopy.blueprint.library.latest}: ${receipt.latestRetiredAt ?? planCopy.blueprint.library.missing} / ${planCopy.blueprint.library.observed}: ${receipt.observedLatestRetiredAt ?? planCopy.blueprint.library.missing}`
          : ""}
      </small>
    </>
  );
}
