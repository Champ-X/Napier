import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptOutcomeDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "outcomeBaseline" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.created
              ? planCopy.blueprint.library.outcomeBaselineCreated
              : planCopy.blueprint.library.outcomeBaselineReused}
            {" / "}
            {planCopy.blueprint.library.outcomeBaseline}:{" "}
            {receipt.baselineSha256.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%{" / "}
            {planCopy.blueprint.library.min}:{" "}
            {(receipt.minCompletionRateBps / 100).toFixed(2)}%
          </small>
          {receipt.reviewSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.review}:{" "}
              {receipt.reviewSha256.slice(0, 16)}
              {receipt.reviewScore !== undefined
                ? ` / ${planCopy.blueprint.library.score}: ${receipt.reviewScore.toLocaleString()}`
                : ""}
              {receipt.reviewRisk
                ? ` / ${planCopy.blueprint.library.risk}: ${planCopy.blueprint.library.outcomeReviewRisks[receipt.reviewRisk]}`
                : ""}
              {receipt.reviewVerdict
                ? ` / ${planCopy.blueprint.library.outcomeReviewVerdicts[receipt.reviewVerdict]}`
                : ""}
              {receipt.reviewGateMinScore !== undefined
                ? ` / ${planCopy.blueprint.library.min}: ${receipt.reviewGateMinScore.toLocaleString()}`
                : ""}
              {receipt.reviewModel ? ` / ${receipt.reviewModel}` : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "outcomeQualified" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.current}:{" "}
            {receipt.currentOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.completion}:{" "}
            {(receipt.completionRateBps / 100).toFixed(2)}%
            {receipt.minCompletionRateBps !== undefined
              ? ` / ${planCopy.blueprint.library.min}: ${(receipt.minCompletionRateBps / 100).toFixed(2)}%`
              : ""}
          </small>
        </>
      ) : null}
      {receipt.action === "outcomeReviewed" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.score}: {receipt.score.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.risk}:{" "}
            {planCopy.blueprint.library.outcomeReviewRisks[receipt.risk]}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.current}:{" "}
            {receipt.replayOutcomesSha256.slice(0, 16)}
            {receipt.baselineSha256
              ? ` / ${planCopy.blueprint.library.outcomeBaseline}: ${receipt.baselineSha256.slice(0, 16)}`
              : ""}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.input}:{" "}
            {receipt.inputSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.response}:{" "}
            {receipt.responseSha256.slice(0, 16)}
          </small>
          {receipt.reviewEnvelopeSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.envelope}: {receipt.reviewEnvelopeSha256.slice(0, 16)}
              {" / "}
              {planCopy.receipt}: {receipt.reviewSha256.slice(0, 16)}
            </small>
          ) : null}
          {receipt.concerns.length > 0 ? (
            <small className="fixture-diagnostics">
              {receipt.concerns.join(", ")}
            </small>
          ) : null}
        </>
      ) : null}
    </>
  );
}
