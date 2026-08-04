import type { PlanBlueprintLibraryReceipt } from "./plan-blueprint-library-panel-types";
import { planCopy } from "./plan-copy";

export function PlanBlueprintLibraryReceiptSignedDetails({
  receipt,
}: {
  receipt: PlanBlueprintLibraryReceipt;
}) {
  return (
    <>
      {receipt.action === "policyOverrideRetirementProofBundleSigned" ? (
        <>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.signed}: {receipt.signedAt}
            {" / "}
            {planCopy.blueprint.library.signer}: {receipt.keyId.slice(0, 16)}
          </small>
          <small className="fixture-diagnostics">
            {planCopy.blueprint.library.receipt}:{" "}
            {receipt.receiptContentSha256.slice(0, 16)}
            {" / "}
            {planCopy.blueprint.library.artifact}:{" "}
            {receipt.receiptArtifactSha256.slice(0, 16)}
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
            {planCopy.blueprint.library.historySet}:{" "}
            {receipt.distinctHistoryCount.toLocaleString()}
            {" / "}
            {planCopy.blueprint.library.retirementSet}:{" "}
            {receipt.distinctRetirementSetCount.toLocaleString()}
          </small>
        </>
      ) : null}
      {receipt.action === "created" &&
      (receipt.replayEventSha256 ||
        receipt.replayEventVerificationStatus ||
        receipt.replayEventDiagnostics) ? (
        <>
          {receipt.replayEventSha256 ? (
            <small className="fixture-diagnostics">
              {planCopy.blueprint.library.eventAnchor}:{" "}
              {receipt.replayEventSha256.slice(0, 16)}
              {receipt.replayEventId
                ? ` / ${shortId(receipt.replayEventId)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventVerificationStatus ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventVerificationStatus === "valid"
                ? planCopy.blueprint.library.eventVerified
                : planCopy.blueprint.library.eventInvalid}
              {receipt.replayEventVerificationSha256
                ? ` / ${planCopy.blueprint.library.eventVerification}: ${receipt.replayEventVerificationSha256.slice(0, 16)}`
                : ""}
            </small>
          ) : null}
          {receipt.replayEventDiagnostics ? (
            <small className="fixture-diagnostics">
              {receipt.replayEventDiagnostics.length > 0
                ? receipt.replayEventDiagnostics.join(", ")
                : planCopy.blueprint.library.noDiagnostics}
            </small>
          ) : null}
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
