import type {
  InboundDeadLetterRetryHistory,
  InboundDeadLetterRetryHistoryVerification,
} from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { formatAutomationDateTime } from "./automation-panel-helpers";

export interface AutomationDeadLetterHistoryEvidenceProps {
  history: InboundDeadLetterRetryHistory | undefined;
  verification: InboundDeadLetterRetryHistoryVerification | undefined;
  downloading: boolean;
  verifying: boolean;
  onDownload: () => void;
  onVerifyFile: (file: File) => void;
  onVerify: () => void;
}

export function AutomationDeadLetterHistoryEvidence({
  history,
  verification,
  downloading,
  verifying,
  onDownload,
  onVerifyFile,
  onVerify,
}: AutomationDeadLetterHistoryEvidenceProps) {
  if (!history) return null;
  const latest = history.records.at(-1);
  return (
    <div className="dead-letter-retry-history" role="status">
      <strong>{copy.deadLetterRetryHistory}</strong>
      <p>
        {copy.deadLetterRetryHistoryEvents} {history.eventCount} ·{" "}
        <code title={history.eventSetSha256}>
          {copy.deadLetterRetryHistorySet} {history.eventSetSha256.slice(0, 12)}
        </code>{" "}
        ·{" "}
        <code title={history.contentSha256}>
          {copy.historyHash} {history.contentSha256.slice(0, 12)}
        </code>
      </p>
      {latest ? (
        <LatestHistoryRecord record={latest} />
      ) : (
        <small>{copy.deadLetterRetryHistoryEmpty}</small>
      )}
      {verification ? (
        <HistoryVerification verification={verification} />
      ) : null}
      <button
        type="button"
        disabled={downloading}
        aria-busy={downloading}
        onClick={onDownload}
      >
        {downloading
          ? copy.downloadingDeadLetterRetryHistory
          : copy.downloadDeadLetterRetryHistory}
      </button>
      <label className="channel-file-action" aria-disabled={verifying}>
        {verifying
          ? copy.verifyingDeadLetterRetryHistory
          : copy.verifyDeadLetterRetryHistoryFile}
        <input
          type="file"
          accept="application/json,.json"
          disabled={verifying}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onVerifyFile(file);
          }}
        />
      </label>
      <button
        type="button"
        disabled={verifying}
        aria-busy={verifying}
        onClick={onVerify}
      >
        {verifying
          ? copy.verifyingDeadLetterRetryHistory
          : copy.verifyDeadLetterRetryHistory}
      </button>
    </div>
  );
}

type HistoryRecord = InboundDeadLetterRetryHistory["records"][number];

function LatestHistoryRecord({ record }: { record: HistoryRecord }) {
  return (
    <small>
      {copy.deadLetterRetryHistoryLatest}{" "}
      {formatAutomationDateTime(record.createdAt)} ·{" "}
      {record.applyResultSha256 ? (
        <>
          <code title={record.applyResultSha256}>
            {copy.deadLetterRetryHistoryApply}{" "}
            {record.applyResultSha256.slice(0, 12)}
          </code>{" "}
          ·{" "}
        </>
      ) : null}
      <code title={record.previewSha256}>
        {copy.previewHash} {record.previewSha256.slice(0, 12)}
      </code>{" "}
      ·{" "}
      <code title={record.retriedDeliveryIdsSha256}>
        {copy.retriedHash} {record.retriedDeliveryIdsSha256.slice(0, 12)}
      </code>
    </small>
  );
}

function HistoryVerification({
  verification,
}: {
  verification: InboundDeadLetterRetryHistoryVerification;
}) {
  return (
    <small>
      {verification.status === "valid"
        ? copy.deadLetterRetryHistoryVerificationValid
        : copy.deadLetterRetryHistoryVerificationInvalid}{" "}
      ·{" "}
      <code title={verification.contentSha256}>
        {copy.verificationHash} {verification.contentSha256.slice(0, 12)}
      </code>
      {verification.observedEventSetSha256 ? (
        <>
          {" "}
          ·{" "}
          <code title={verification.observedEventSetSha256}>
            {copy.observedHash}{" "}
            {verification.observedEventSetSha256.slice(0, 12)}
          </code>
        </>
      ) : null}
      {verification.diagnostics[0] ? ` · ${verification.diagnostics[0]}` : null}
    </small>
  );
}
