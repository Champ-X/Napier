import type { ArtifactManifestEntry } from "@napier/contracts";

import { formatArtifactSizeBytes } from "./artifact-manifest-view-model";
import type { PlanArtifactManifestItemView } from "./plan-artifact-manifest-model";
import type {
  PlanArtifactDetailState,
  PlanArtifactManifestActions,
} from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";
import { PlanArtifactLedgerReceiptLine } from "./PlanArtifactLedgerReceiptLine";

export function PlanArtifactDriftDetails({
  artifact,
  busyId,
  details,
  view,
  actions,
}: {
  artifact: ArtifactManifestEntry;
  busyId: string | undefined;
  details: PlanArtifactDetailState;
  view: PlanArtifactManifestItemView;
  actions: PlanArtifactManifestActions;
}) {
  const check = details.driftCheck;
  if (!check) return null;
  return (
    <div
      className={`artifact-drift-check artifact-drift-check--${check.result}`}
      role="status"
    >
      <strong>{planCopy.artifactActions.driftCheckTitle}</strong>
      <span>{planCopy.artifactActions.driftResults[check.result]}</span>
      <small>
        {planCopy.expected}:{" "}
        <code title={check.expectedSha256}>
          {check.expectedSha256.slice(0, 16)}
        </code>
        {check.observedSha256 ? (
          <>
            {" / "}
            {planCopy.observed}:{" "}
            <code title={check.observedSha256}>
              {check.observedSha256.slice(0, 16)}
            </code>
          </>
        ) : null}
        {check.sizeBytes !== undefined ? (
          <>
            {" / "}
            {planCopy.size}: {formatArtifactSizeBytes(check.sizeBytes)}
          </>
        ) : null}
      </small>
      <PlanArtifactLedgerReceiptLine receipt={check} />
      {view.driftCheckAction.hasAction ? (
        <div className="artifact-drift-check__actions">
          <button
            type="button"
            aria-label={`${
              view.driftCheckAction.canRecheck
                ? view.verifyLabel
                : view.missingLabel
            }: ${artifact.path}`}
            disabled={Boolean(busyId)}
            onClick={() =>
              actions.onUpdate(
                artifact,
                view.driftCheckAction.nextAction ?? "missing",
              )
            }
          >
            {busyId === `${artifact.id}:${view.driftCheckAction.nextAction}`
              ? view.driftCheckAction.canRecheck
                ? view.verifyingLabel
                : view.markingMissingLabel
              : view.driftCheckAction.canRecheck
                ? view.verifyLabel
                : view.missingLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
