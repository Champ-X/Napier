import type { ArtifactManifestEntry } from "@napier/contracts";

import type { PlanArtifactManifestItemView } from "./plan-artifact-manifest-model";
import type { PlanArtifactManifestActions } from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";

export function PlanArtifactActions({
  artifact,
  busyId,
  view,
  handlers,
}: {
  artifact: ArtifactManifestEntry;
  busyId: string | undefined;
  view: PlanArtifactManifestItemView;
  handlers: PlanArtifactManifestActions;
}) {
  const availability = view.actions;
  if (!availability.hasActions) return null;
  return (
    <div className="artifact-actions">
      {availability.canProduce ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.produce}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onUpdate(artifact, "produced")}
        >
          {busyId === `${artifact.id}:produced`
            ? planCopy.artifactActions.producing
            : planCopy.artifactActions.produce}
        </button>
      ) : null}
      {availability.canPreview ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.preview}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onPreviewText(artifact)}
        >
          {busyId === `${artifact.id}:preview`
            ? planCopy.artifactActions.previewing
            : planCopy.artifactActions.preview}
        </button>
      ) : null}
      {availability.canProfileData ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.dataProfile}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onProfileData(artifact)}
        >
          {busyId === `${artifact.id}:data`
            ? planCopy.artifactActions.dataProfiling
            : planCopy.artifactActions.dataProfile}
        </button>
      ) : null}
      {availability.canInspectManifest ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.manifest}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onInspectDirectoryManifest(artifact)}
        >
          {busyId === `${artifact.id}:manifest`
            ? planCopy.artifactActions.manifesting
            : planCopy.artifactActions.manifest}
        </button>
      ) : null}
      {availability.canDownload ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.download}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onDownload(artifact)}
        >
          {busyId === `${artifact.id}:download`
            ? planCopy.artifactActions.downloading
            : planCopy.artifactActions.download}
        </button>
      ) : null}
      {availability.canVerifyFileArchive ? (
        <label
          className="artifact-profile-file-action"
          aria-disabled={Boolean(busyId)}
        >
          {busyId === `${artifact.id}:file-verify`
            ? planCopy.artifactActions.verifyingFile
            : planCopy.artifactActions.verifyFile}
          <input
            className="fixture-file-input"
            type="file"
            disabled={Boolean(busyId)}
            aria-label={planCopy.artifactActions.verifyFile}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) handlers.onVerifyFile(artifact, file);
            }}
          />
        </label>
      ) : null}
      {availability.canVerify ? (
        <button
          type="button"
          aria-label={`${view.verifyLabel}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onUpdate(artifact, "verified")}
        >
          {busyId === `${artifact.id}:verified`
            ? view.verifyingLabel
            : view.verifyLabel}
        </button>
      ) : null}
      {availability.canCheckDrift ? (
        <button
          type="button"
          aria-label={`${planCopy.artifactActions.checkDrift}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onCheckDrift(artifact)}
        >
          {busyId === `${artifact.id}:drift-check`
            ? planCopy.artifactActions.checkingDrift
            : planCopy.artifactActions.checkDrift}
        </button>
      ) : null}
      {availability.canMarkMissing ? (
        <button
          type="button"
          aria-label={`${view.missingLabel}: ${artifact.path}`}
          disabled={Boolean(busyId)}
          onClick={() => handlers.onUpdate(artifact, "missing")}
        >
          {busyId === `${artifact.id}:missing`
            ? view.markingMissingLabel
            : view.missingLabel}
        </button>
      ) : null}
    </div>
  );
}
