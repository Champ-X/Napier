import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptReplayOutcomeDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "outcomes" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.replayHistory}:{" "}
            {receipt.replayHistorySha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.outcomeSet}:{" "}
            {receipt.outcomeSetSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {receipt.activeCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.active}
            {" / "}
            {receipt.cancelledCount.toLocaleString()}{" "}
            {planCopy.blueprint.library.cancelled}
            {receipt.latestStatus
              ? ` / ${planCopy.blueprint.library.latest}: ${planCopy.blueprint.library.outcomeStatuses[receipt.latestStatus]}`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomesVerified" ? (
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
          {receipt.declaredOutcomeSetSha256 ||
          receipt.observedOutcomeSetSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.outcomeSet}:{" "}
              {receipt.declaredOutcomeSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedOutcomeSetSha256
                ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedOutcomeSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
    </>
  );
}
