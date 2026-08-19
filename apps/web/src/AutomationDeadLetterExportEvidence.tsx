import type { InboundDeadLetterExportVerification } from "@napier/contracts";

import { automationCopy as copy } from "./automation-copy";
import { deadLetterVerificationHash } from "./automation-panel-helpers";
import type { DeadLetterExportSummary } from "./use-automation-dead-letter-artifacts";

export interface AutomationDeadLetterExportEvidenceProps {
  exported: DeadLetterExportSummary | undefined;
  verification: InboundDeadLetterExportVerification | undefined;
}

export function AutomationDeadLetterExportEvidence({
  exported,
  verification,
}: AutomationDeadLetterExportEvidenceProps) {
  return (
    <>
      {exported ? <ExportReceipt exported={exported} /> : null}
      {verification ? (
        <VerificationReceipt verification={verification} />
      ) : null}
    </>
  );
}

function ExportReceipt({ exported }: { exported: DeadLetterExportSummary }) {
  return (
    <p className="dead-letter-receipt" role="status">
      {copy.exported} {exported.deliveryCount} ·{" "}
      <code title={exported.contentSha256}>
        SHA-256 {exported.contentSha256.slice(0, 12)}
      </code>
      <span>
        {copy.qualifiedShort} {exported.qualifiedCount} · {copy.missingShort}{" "}
        {exported.evidenceMissingCount} · {copy.driftShort}{" "}
        {exported.adapterCatalogDriftCount}
      </span>
    </p>
  );
}

function VerificationReceipt({
  verification,
}: {
  verification: InboundDeadLetterExportVerification;
}) {
  const contentHash = deadLetterVerificationHash(verification);
  return (
    <p
      className={`dead-letter-receipt verification-${verification.status}`}
      role="status"
    >
      {verification.status === "valid"
        ? copy.deadLetterVerificationValid
        : copy.deadLetterVerificationInvalid}{" "}
      · <code title={contentHash}>SHA-256 {contentHash.slice(0, 12)}</code>
      <span>
        {copy.qualifiedShort}{" "}
        {verification.observedQualifiedCount ??
          verification.qualifiedCount ??
          0}{" "}
        · {copy.missingShort}{" "}
        {verification.observedEvidenceMissingCount ??
          verification.evidenceMissingCount ??
          0}{" "}
        · {copy.driftShort}{" "}
        {verification.observedAdapterCatalogDriftCount ??
          verification.adapterCatalogDriftCount ??
          0}
      </span>
      {verification.diagnostics[0] ? (
        <small>{verification.diagnostics[0]}</small>
      ) : null}
    </p>
  );
}
