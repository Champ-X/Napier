import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptHistoryDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "qualified" || receipt.action === "previewed" ? (
        <>
          <small className="fixture-diagnostics">
            {receipt.diagnostics.length > 0
              ? receipt.diagnostics.join(", ")
              : planCopy.blueprint.library.noDiagnostics}
          </small>
          {receipt.action === "qualified" &&
          receipt.expectedPlanArchiveSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.expected}:{" "}
              {receipt.expectedPlanArchiveSha256.slice(0, 16)}
              {receipt.actualPlanArchiveSha256
                ? ` / ${planCopy.blueprint.library.actual}: ${receipt.actualPlanArchiveSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
      {receipt.action === "history" ? (
        <small className="fixture-diagnostics">
          {planCopy.blueprint.library.eventSet}:{" "}
          {receipt.eventSetSha256.slice(0, 16)}
          {receipt.latestPreviewSha256
            ? ` / ${planCopy.blueprint.library.latestPreview}: ${receipt.latestPreviewSha256.slice(0, 16)}`
            : ""}
        </small>
      ) : null}
      {receipt.action === "historyVerified" ? (
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
          {receipt.declaredEventSetSha256 || receipt.observedEventSetSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.eventSet}:{" "}
              {receipt.declaredEventSetSha256?.slice(0, 16) ?? "missing"}
              {receipt.observedEventSetSha256
                ? ` / ${planCopy.blueprint.library.observed}: ${receipt.observedEventSetSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
        </>
      ) : null}
    </>
  );
}
