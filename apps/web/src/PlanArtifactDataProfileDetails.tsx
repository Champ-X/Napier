import type { ArtifactManifestEntry } from "@napier/contracts";

import { projectArtifactDataProfileView } from "./artifact-data-profile-view-model";
import type {
  PlanArtifactDetailState,
  PlanArtifactManifestActions,
} from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";
import { PlanArtifactLedgerReceiptLine } from "./PlanArtifactLedgerReceiptLine";

export function PlanArtifactDataProfileDetails({
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
  const profile = details.dataProfile;
  if (!profile) return null;
  const view = projectArtifactDataProfileView(profile);
  return (
    <div
      className="artifact-preview artifact-data-profile"
      role="region"
      aria-label={planCopy.artifactActions.dataProfileTitle}
    >
      <header>
        <strong>{planCopy.artifactActions.dataProfileTitle}</strong>
        <button
          type="button"
          aria-label={planCopy.artifactActions.downloadDataProfile}
          onClick={() => actions.onDownloadDataProfile(profile)}
        >
          {planCopy.artifactActions.downloadDataProfile}
        </button>
        <label
          className="artifact-profile-file-action"
          aria-disabled={Boolean(busyId)}
        >
          {busyId === `${artifact.id}:data-verify`
            ? planCopy.artifactActions.verifyingDataProfile
            : planCopy.artifactActions.verifyDataProfile}
          <input
            className="fixture-file-input"
            type="file"
            accept="application/json,.json"
            disabled={Boolean(busyId)}
            aria-label={planCopy.artifactActions.verifyDataProfile}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void actions.onVerifyDataProfile(artifact, file);
            }}
          />
        </label>
        <button
          type="button"
          aria-label={planCopy.artifactActions.closePreview}
          onClick={actions.onCloseDataProfile}
        >
          {planCopy.artifactActions.closePreview}
        </button>
      </header>
      <small>
        {planCopy.artifactActions.dataFormat}: {view.formatLabel}
        {" / "}
        {planCopy.artifactActions.rows}: {profile.rowCount}
        {" / "}
        {planCopy.artifactActions.columns}: {profile.columnCount}
        {" / "}
        {planCopy.artifactActions.truncated}: {String(profile.truncated)}
      </small>
      <small>
        {planCopy.artifactActions.columnSet}:{" "}
        <code title={profile.columnSetSha256}>{view.columnSetShortSha256}</code>
        {" / "}
        {planCopy.artifactActions.sample}:{" "}
        <code title={profile.sampleSha256}>{view.sampleShortSha256}</code>
      </small>
      <PlanArtifactLedgerReceiptLine receipt={profile} />
      {details.dataProfileVerification ? (
        <div
          className={`artifact-data-profile-verification status-${details.dataProfileVerification.verificationStatus}`}
        >
          <strong>
            {
              planCopy.artifactActions.dataProfileVerificationStatuses[
                details.dataProfileVerification.verificationStatus
              ]
            }
          </strong>
          <small>
            {planCopy.artifactActions.observed}:{" "}
            <code title={details.dataProfileVerification.observedSha256}>
              {details.dataProfileVerification.observedSha256.slice(0, 16)}
            </code>
            {" / "}
            {planCopy.artifactActions.sample}:{" "}
            <code title={details.dataProfileVerification.observedSampleSha256}>
              {details.dataProfileVerification.observedSampleSha256.slice(
                0,
                16,
              )}
            </code>
          </small>
          <PlanArtifactLedgerReceiptLine
            receipt={details.dataProfileVerification}
          />
          {details.dataProfileVerification.diagnostics.length > 0 ? (
            <small>
              {details.dataProfileVerification.diagnostics.join(", ")}
            </small>
          ) : null}
        </div>
      ) : null}
      {view.hasColumns ? (
        <div className="artifact-data-table">
          <table>
            <caption>{planCopy.artifactActions.sampleRowsCaption}</caption>
            <thead>
              <tr>
                {view.columns.map((column) => (
                  <th key={column.id} scope="col" title={column.label}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.hasSampleRows ? (
                view.rows.map((row) => (
                  <tr key={row.id}>
                    {row.cells.map((cell) => (
                      <td key={cell.id} title={cell.value}>
                        {cell.value}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    className="artifact-data-table-empty"
                    colSpan={view.columns.length}
                  >
                    {planCopy.artifactActions.noRows}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <small>{planCopy.artifactActions.noRows}</small>
      )}
    </div>
  );
}
