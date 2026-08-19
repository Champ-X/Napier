import type {
  InboundDeadLetterRetryApplyResult,
  InboundDeadLetterRetryPreview,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";

export interface AutomationDeadLetterRetryEvidenceProps {
  preview: InboundDeadLetterRetryPreview | undefined;
  result: InboundDeadLetterRetryApplyResult | undefined;
  confirming: boolean;
  applying: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onApply: () => void;
}

export function AutomationDeadLetterRetryEvidence({
  preview,
  result,
  confirming,
  applying,
  onRequest,
  onCancel,
  onApply,
}: AutomationDeadLetterRetryEvidenceProps) {
  return (
    <>
      {preview ? (
        <RetryPreviewReceipt
          preview={preview}
          confirming={confirming}
          applying={applying}
          onRequest={onRequest}
          onCancel={onCancel}
          onApply={onApply}
        />
      ) : null}
      {result ? <RetryResultReceipt result={result} /> : null}
    </>
  );
}

interface RetryPreviewReceiptProps extends Omit<
  AutomationDeadLetterRetryEvidenceProps,
  "preview" | "result"
> {
  preview: InboundDeadLetterRetryPreview;
}

function RetryPreviewReceipt({
  preview,
  confirming,
  applying,
  onRequest,
  onCancel,
  onApply,
}: RetryPreviewReceiptProps) {
  const actionable =
    preview.retryableCount > 0 && preview.verificationStatus === "valid";
  return (
    <div
      className={`dead-letter-retry-receipt verification-${actionable ? "valid" : "invalid"}`}
      role="status"
    >
      <strong>{copy.deadLetterRetryPreview}</strong>
      <p>
        {copy.retryableShort} {preview.retryableCount} · {copy.blockedShort}{" "}
        {preview.blockedCount} ·{" "}
        <code title={preview.candidateSetSha256}>
          {copy.candidateSetHash} {preview.candidateSetSha256.slice(0, 12)}
        </code>{" "}
        ·{" "}
        <code title={preview.contentSha256}>
          {copy.previewHash} {preview.contentSha256.slice(0, 12)}
        </code>
      </p>
      {preview.candidates[0] ? (
        <small>
          {preview.candidates[0].deliveryId}:{" "}
          {copy.deadLetterRetryCandidateStatuses[preview.candidates[0].status]}
        </small>
      ) : null}
      {preview.diagnostics[0] ? <small>{preview.diagnostics[0]}</small> : null}
      {actionable ? (
        confirming ? (
          <div className="dead-letter-retry-confirm">
            <p>{copy.deadLetterRetryConfirmBody}</p>
            <button type="button" disabled={applying} onClick={onCancel}>
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={applying}
              aria-busy={applying}
              onClick={onApply}
            >
              {applying
                ? copy.applyingDeadLetterRetry
                : copy.applyDeadLetterRetryNow}
            </button>
          </div>
        ) : (
          <button type="button" disabled={applying} onClick={onRequest}>
            {copy.applyDeadLetterRetry}
          </button>
        )
      ) : null}
    </div>
  );
}

function RetryResultReceipt({
  result,
}: {
  result: InboundDeadLetterRetryApplyResult;
}) {
  return (
    <p className="dead-letter-receipt" role="status">
      {copy.deadLetterRetryApplied} {result.retriedCount} · {copy.blockedShort}{" "}
      {result.skippedCount} ·{" "}
      <code title={result.previewCandidateSetSha256}>
        {copy.previewSetHash} {result.previewCandidateSetSha256.slice(0, 12)}
      </code>{" "}
      ·{" "}
      <code title={result.retriedDeliveryIdsSha256}>
        {copy.retriedHash} {result.retriedDeliveryIdsSha256.slice(0, 12)}
      </code>{" "}
      ·{" "}
      <code title={result.contentSha256}>
        {copy.resultHash} {result.contentSha256.slice(0, 12)}
      </code>
    </p>
  );
}
