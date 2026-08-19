import { Download, Pencil } from "lucide-react";

import { copy } from "./copy";
import { EvaluationCasebookCuration } from "./EvaluationCasebookCuration";
import { EvaluationCasebookQualification } from "./EvaluationCasebookQualification";
import { formatDateTime } from "./evaluation-casebook-artifacts";
import { EvaluationCasebookTemplateCoverage } from "./EvaluationCasebookTemplateControl";
import { EvaluationReleaseGateControls } from "./EvaluationReleaseGateControls";
import type { useEvaluationCasebook } from "./use-evaluation-casebook";

type EvaluationCasebookState = ReturnType<typeof useEvaluationCasebook>;

export interface EvaluationCasebookVolumeProps {
  state: EvaluationCasebookState;
}

export function EvaluationCasebookVolume({
  state,
}: EvaluationCasebookVolumeProps) {
  const {
    selected,
    revision,
    busyId,
    beginEdit,
    currentCases,
    calibration,
    selectedTemplate,
    setTemplateCaseId,
    templateCaseId,
    threadId,
    runs,
    exportArtifact,
    onUseTaskPrompt,
  } = state;
  if (!selected || !revision) return null;
  return (
    <article className="casebook-volume">
      <header>
        <div>
          <span>
            {copy.lab.casebook.currentRevision} {revision.revision}
          </span>
          <h5>{revision.name}</h5>
        </div>
        <button type="button" disabled={Boolean(busyId)} onClick={beginEdit}>
          <Pencil size={10} aria-hidden="true" />
          {copy.lab.casebook.edit}
        </button>
      </header>
      {revision.description ? <p>{revision.description}</p> : null}
      <dl className="casebook-metrics">
        <div>
          <dt>{copy.lab.casebook.cases}</dt>
          <dd>{currentCases.length}</dd>
        </div>
        <div>
          <dt>{copy.lab.casebook.agreement}</dt>
          <dd>
            {calibration?.sampleCount
              ? `${Math.round(calibration.agreementRate * 100)}%`
              : "–"}
          </dd>
        </div>
        <div>
          <dt>{copy.lab.casebook.cohorts}</dt>
          <dd>{calibration?.groups.length ?? 0}</dd>
        </div>
      </dl>

      <EvaluationCasebookTemplateCoverage
        casebook={selected}
        cases={currentCases}
        template={selectedTemplate}
        selectedCaseId={templateCaseId}
        disabled={Boolean(busyId)}
        onSelect={setTemplateCaseId}
        onUseTaskPrompt={onUseTaskPrompt}
      />

      <EvaluationReleaseGateControls
        threadId={threadId}
        casebook={selected}
        template={selectedTemplate}
        selectedCaseId={templateCaseId}
        runs={runs}
      />

      <EvaluationCasebookCuration state={state} />

      <EvaluationCasebookQualification state={state} />

      {calibration?.groups.length ? (
        <div className="casebook-cohorts">
          {calibration.groups.map((group) => (
            <div
              key={`${group.evaluatorModel.provider}/${group.evaluatorModel.id}/${group.rubricSha256}`}
            >
              <span>
                <strong>
                  {group.evaluatorModel.provider}/{group.evaluatorModel.id}
                </strong>
                <small>{group.rubricName}</small>
              </span>
              <span>
                <strong>{Math.round(group.agreementRate * 100)}%</strong>
                <small>
                  {group.sampleCount} {copy.lab.casebook.samples}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <details className="casebook-history">
        <summary>
          <span>{copy.lab.casebook.history}</span>
          <code>{selected.revisions.length}</code>
        </summary>
        <ol>
          {selected.revisions
            .slice()
            .reverse()
            .map((item) => (
              <li key={item.revision}>
                <span>
                  r{item.revision} ·{" "}
                  {copy.lab.casebook.revisionSources[item.source]}
                </span>
                <code title={item.contentSha256}>
                  {item.contentSha256.slice(0, 10)}
                </code>
                <time dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt)}
                </time>
              </li>
            ))}
        </ol>
      </details>

      <footer className="casebook-volume-footer">
        {calibration ? (
          <code title={calibration.contentSha256}>
            {copy.lab.casebook.reportHash}{" "}
            {calibration.contentSha256.slice(0, 12)}
          </code>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => void exportArtifact()}
        >
          <Download size={11} aria-hidden="true" />
          {busyId === `export:${selected.id}`
            ? copy.lab.casebook.exporting
            : copy.lab.casebook.export}
        </button>
      </footer>
    </article>
  );
}
