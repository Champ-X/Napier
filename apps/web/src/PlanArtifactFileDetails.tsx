import type { ArtifactManifestEntry } from "@napier/contracts";

import { formatArtifactSizeBytes } from "./artifact-manifest-view-model";
import type {
  PlanArtifactDetailState,
  PlanArtifactManifestActions,
} from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";
import { PlanArtifactDataProfileDetails } from "./PlanArtifactDataProfileDetails";
import { PlanArtifactLedgerReceiptLine } from "./PlanArtifactLedgerReceiptLine";

export function PlanArtifactFileDetails({
  artifact,
  busyId,
  details,
  actions,
}: {
  artifact: ArtifactManifestEntry;
  busyId: string | undefined;
  details: PlanArtifactDetailState;
  actions: PlanArtifactManifestActions;
}) {
  return (
    <>
      {details.fileDownload ? (
        <div
          className="artifact-data-profile-verification status-valid"
          role="status"
        >
          <strong>{planCopy.artifactActions.download}</strong>
          <small>
            {planCopy.digest}:{" "}
            <code title={details.fileDownload.sha256}>
              {details.fileDownload.sha256.slice(0, 16)}
            </code>
            {" / "}
            {planCopy.size}:{" "}
            {formatArtifactSizeBytes(details.fileDownload.sizeBytes)}
            {" / "}
            {details.fileDownload.filename}
          </small>
          <PlanArtifactLedgerReceiptLine receipt={details.fileDownload} />
        </div>
      ) : null}
      {details.fileVerification ? (
        <div
          className={`artifact-data-profile-verification status-${details.fileVerification.verificationStatus}`}
          role="status"
        >
          <strong>
            {
              planCopy.artifactActions.fileVerificationStatuses[
                details.fileVerification.verificationStatus
              ]
            }
          </strong>
          <small>
            {planCopy.expected}:{" "}
            <code title={details.fileVerification.expectedSha256}>
              {details.fileVerification.expectedSha256.slice(0, 16)}
            </code>
            {" / "}
            {planCopy.observed}:{" "}
            <code title={details.fileVerification.observedSha256}>
              {details.fileVerification.observedSha256.slice(0, 16)}
            </code>
          </small>
          <small>
            {planCopy.size}:{" "}
            {formatArtifactSizeBytes(
              details.fileVerification.expectedSizeBytes,
            )}
            {" -> "}
            {formatArtifactSizeBytes(
              details.fileVerification.observedSizeBytes,
            )}
          </small>
          <PlanArtifactLedgerReceiptLine receipt={details.fileVerification} />
          {details.fileVerification.diagnostics.length > 0 ? (
            <small>{details.fileVerification.diagnostics.join(", ")}</small>
          ) : null}
        </div>
      ) : null}
      {details.textPreview ? (
        <div
          className="artifact-preview"
          role="region"
          aria-label={planCopy.artifactActions.previewTitle}
        >
          <header>
            <strong>{planCopy.artifactActions.previewTitle}</strong>
            <button
              type="button"
              aria-label={planCopy.artifactActions.closePreview}
              onClick={actions.onCloseTextPreview}
            >
              {planCopy.artifactActions.closePreview}
            </button>
          </header>
          <small>
            {planCopy.digest}:{" "}
            <code title={details.textPreview.textSha256}>
              {details.textPreview.textSha256.slice(0, 16)}
            </code>
            {" / "}
            {planCopy.size}:{" "}
            {formatArtifactSizeBytes(details.textPreview.sizeBytes)}
            {" / "}
            {planCopy.lineCount}: {details.textPreview.lineCount}
          </small>
          <PlanArtifactLedgerReceiptLine receipt={details.textPreview} />
          <pre>{details.textPreview.text}</pre>
        </div>
      ) : null}
      <PlanArtifactDataProfileDetails
        artifact={artifact}
        busyId={busyId}
        details={details}
        actions={actions}
      />
    </>
  );
}
