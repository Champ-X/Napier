import {
  planArtifactDetails,
  projectPlanArtifactManifestItem,
  shortPlanArtifactId,
} from "./plan-artifact-manifest-model";
import type { PlanArtifactManifestProps } from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";
import { projectReplanArtifactRoles } from "./replan-draft-view-model";
import { PlanArtifactActions } from "./PlanArtifactActions";
import { PlanArtifactDirectoryManifestDetails } from "./PlanArtifactDirectoryManifestDetails";
import { PlanArtifactDriftDetails } from "./PlanArtifactDriftDetails";
import { PlanArtifactFileDetails } from "./PlanArtifactFileDetails";

export function PlanArtifactManifest({
  artifacts,
  latestReplan,
  state,
  actions,
}: PlanArtifactManifestProps) {
  if (artifacts.length === 0) return null;
  return (
    <section
      className="artifact-manifest"
      aria-labelledby="artifact-manifest-title"
      aria-busy={Boolean(state.busyId)}
    >
      <header>
        <h3 id="artifact-manifest-title">{planCopy.artifacts}</h3>
        <span>{String(artifacts.length).padStart(2, "0")}</span>
      </header>
      {artifacts.map((artifact) => {
        const details = planArtifactDetails(artifact.id, state);
        const view = projectPlanArtifactManifestItem(artifact, details);
        const replanRoles = projectReplanArtifactRoles(
          artifact.id,
          latestReplan,
        );
        return (
          <article key={artifact.id}>
            <header>
              <code>{artifact.path}</code>
              <div className="plan-entity-status">
                <span className="plan-status-badge">
                  {planCopy.statuses[artifact.status]}
                </span>
                {replanRoles.length > 0 ? (
                  <div
                    className="plan-replan-entity-badges"
                    aria-label={planCopy.latestReplanImpact}
                  >
                    {replanRoles.map((role) => (
                      <span key={role}>{planCopy.replanEntityRoles[role]}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </header>
            <p>{artifact.description}</p>
            {artifact.evidence ? <small>{artifact.evidence}</small> : null}
            {view.evidence.hasEvidence ? (
              <dl>
                {view.evidence.digestShort && view.evidence.digestFull ? (
                  <div>
                    <dt>{planCopy.digest}</dt>
                    <dd>
                      <code title={view.evidence.digestFull}>
                        {view.evidence.digestShort}
                      </code>
                    </dd>
                  </div>
                ) : null}
                {view.evidence.sizeBytesLabel ? (
                  <div>
                    <dt>{planCopy.size}</dt>
                    <dd>{view.evidence.sizeBytesLabel}</dd>
                  </div>
                ) : null}
                {artifact.sourceRunId ? (
                  <div>
                    <dt>{planCopy.source}</dt>
                    <dd>
                      <code>{shortPlanArtifactId(artifact.sourceRunId)}</code>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <PlanArtifactActions
              artifact={artifact}
              busyId={state.busyId}
              view={view}
              handlers={actions}
            />
            <PlanArtifactFileDetails
              artifact={artifact}
              busyId={state.busyId}
              details={details}
              actions={actions}
            />
            <PlanArtifactDirectoryManifestDetails
              artifact={artifact}
              busyId={state.busyId}
              details={details}
              actions={actions}
            />
            <PlanArtifactDriftDetails
              artifact={artifact}
              busyId={state.busyId}
              details={details}
              view={view}
              actions={actions}
            />
          </article>
        );
      })}
      {state.error ? (
        <p className="artifact-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
