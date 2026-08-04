import type { ArtifactManifestEntry } from "@napier/contracts";

import { formatArtifactSizeBytes } from "./artifact-manifest-view-model";
import type {
  PlanArtifactDetailState,
  PlanArtifactManifestActions,
} from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";
import { PlanArtifactLedgerReceiptLine } from "./PlanArtifactLedgerReceiptLine";

export function PlanArtifactDirectoryManifestDetails({
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
  const manifest = details.directoryManifest;
  if (!manifest) return null;
  return (
    <div
      className="artifact-preview artifact-directory-manifest"
      role="region"
      aria-label={planCopy.artifactActions.manifestTitle}
    >
      <header>
        <strong>{planCopy.artifactActions.manifestTitle}</strong>
        <button
          type="button"
          aria-label={planCopy.artifactActions.downloadManifest}
          onClick={() => actions.onDownloadDirectoryManifest(manifest)}
        >
          {planCopy.artifactActions.downloadManifest}
        </button>
        <label
          className="artifact-profile-file-action"
          aria-disabled={Boolean(busyId)}
        >
          {busyId === `${artifact.id}:manifest-verify`
            ? planCopy.artifactActions.verifyingManifest
            : planCopy.artifactActions.verifyManifest}
          <input
            className="fixture-file-input"
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busyId)}
            aria-label={planCopy.artifactActions.verifyManifest}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void actions.onVerifyDirectoryManifest(artifact, file);
            }}
          />
        </label>
        <button
          type="button"
          aria-label={planCopy.artifactActions.closePreview}
          onClick={actions.onCloseDirectoryManifest}
        >
          {planCopy.artifactActions.closePreview}
        </button>
      </header>
      <small>
        {planCopy.digest}:{" "}
        <code title={manifest.sha256}>{manifest.sha256.slice(0, 16)}</code>
        {" / "}
        {planCopy.size}: {formatArtifactSizeBytes(manifest.sizeBytes)}
        {" / "}
        {planCopy.artifactActions.entries}:{" "}
        {manifest.entryCount.toLocaleString()}
        {" / "}
        {planCopy.artifactActions.files}: {manifest.fileCount.toLocaleString()}
        {" / "}
        {planCopy.artifactActions.directories}:{" "}
        {manifest.directoryCount.toLocaleString()}
      </small>
      <PlanArtifactLedgerReceiptLine receipt={manifest} />
      {details.directoryManifestVerification ? (
        <div
          className={`artifact-data-profile-verification status-${details.directoryManifestVerification.verificationStatus}`}
        >
          <strong>
            {
              planCopy.artifactActions.manifestVerificationStatuses[
                details.directoryManifestVerification.verificationStatus
              ]
            }
          </strong>
          <small>
            {planCopy.artifactActions.observed}:{" "}
            <code title={details.directoryManifestVerification.observedSha256}>
              {details.directoryManifestVerification.observedSha256.slice(
                0,
                16,
              )}
            </code>
            {" / "}
            {planCopy.artifactActions.entries}:{" "}
            <code
              title={
                details.directoryManifestVerification.observedEntrySetSha256
              }
            >
              {details.directoryManifestVerification.observedEntrySetSha256.slice(
                0,
                16,
              )}
            </code>
          </small>
          <PlanArtifactLedgerReceiptLine
            receipt={details.directoryManifestVerification}
          />
          {details.directoryManifestVerification.diagnostics.length > 0 ? (
            <small>
              {details.directoryManifestVerification.diagnostics.join(", ")}
            </small>
          ) : null}
        </div>
      ) : null}
      <ol>
        {manifest.entries.map((entry) => (
          <li key={`${entry.kind}:${entry.path}`}>
            <code>{entry.path}</code>
            <span>{entry.kind}</span>
            {entry.sha256 ? (
              <code title={entry.sha256}>{entry.sha256.slice(0, 16)}</code>
            ) : null}
            {entry.sizeBytes !== undefined ? (
              <span>{formatArtifactSizeBytes(entry.sizeBytes)}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
