import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptProofBundleDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  if (receipt.action !== "policyOverrideRetirementProofBundle") return null;
  return (
    <>
      <small className="fixture-diagnostics">
        {receipt.diagnostics.length > 0
          ? receipt.diagnostics.join(", ")
          : planCopy.blueprint.library.noDiagnostics}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.histories}:{" "}
        {receipt.historyCount.toLocaleString()}
        {" / "}
        {planCopy.blueprint.library.valid}:{" "}
        {receipt.validHistoryCount.toLocaleString()}
        {" / "}
        {planCopy.blueprint.library.invalid}:{" "}
        {receipt.invalidHistoryCount.toLocaleString()}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.retirementSet}:{" "}
        {receipt.retirementSetBundleSha256.slice(0, 16)}
        {" / "}
        {planCopy.blueprint.library.historySet}:{" "}
        {receipt.historySetSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.portfolioSet}:{" "}
        {receipt.portfolioSetBundleSha256.slice(0, 16)}
        {" / "}
        {planCopy.blueprint.library.overrideSet}:{" "}
        {receipt.currentOverrideSetBundleSha256.slice(0, 16)}
      </small>
      <small className="fixture-diagnostics">
        {planCopy.blueprint.library.divergent}:{" "}
        {receipt.distinctRetirementSetCount.toLocaleString()}{" "}
        {planCopy.blueprint.library.retirementSet}
        {" / "}
        {receipt.distinctPortfolioSetCount.toLocaleString()}{" "}
        {planCopy.blueprint.library.portfolioSet}
        {" / "}
        {receipt.distinctCurrentOverrideSetCount.toLocaleString()}{" "}
        {planCopy.blueprint.library.overrideSet}
      </small>
      {receipt.highlightedHistoryIndex !== undefined ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.highlighted}:{" "}
          {receipt.highlightedHistoryIndex.toLocaleString()}
          {receipt.highlightedHistoryStatus
            ? ` / ${receipt.highlightedHistoryStatus}`
            : ""}
          {receipt.highlightedHistoryContentSha256
            ? ` / ${receipt.highlightedHistoryContentSha256.slice(0, 16)}`
            : ""}
          {receipt.highlightedRetirementSetSha256
            ? ` / ${planCopy.blueprint.library.retirementSet}: ${receipt.highlightedRetirementSetSha256.slice(0, 16)}`
            : ""}
        </small>
      ) : null}
      {receipt.highlightedHistoryDiagnostics.length > 0 ? (
        <small className="fixture-diagnostics">
          {receipt.highlightedHistoryDiagnostics.join(", ")}
        </small>
      ) : null}
    </>
  );
}
