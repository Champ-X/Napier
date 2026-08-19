import { Download, ExternalLink, Play, ShieldCheck } from "lucide-react";

import type {
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResultFrame,
} from "@napier/contracts";

import { workflowExperimentCopy as copy } from "./workflow-experiment-copy";
import {
  formatSignedWorkflowMetric as formatSigned,
  shortWorkflowResultId as shortId,
  workflowExperimentChangeLabel as changeLabel,
  workflowExperimentStatusLabel as statusLabel,
  workflowMetricDeltaClass as deltaClass,
} from "./workflow-experiment-docket-format";
import type { WorkflowExperimentComparisonView } from "./workflow-experiment-view-model";
import { WorkflowExperimentNodeComparison } from "./WorkflowExperimentNodeComparison";

export function WorkflowExperimentPreviewDocket({
  preview,
  confirmed,
  busy,
  disabled,
  streamedFrameCount,
  onConfirmed,
  onExecute,
}: {
  preview: ExecutionPlanWorkflowExperimentPreview;
  confirmed: boolean;
  busy: boolean;
  disabled: boolean;
  streamedFrameCount: number;
  onConfirmed: (confirmed: boolean) => void;
  onExecute: () => void;
}) {
  const totalEffects = preview.toolEffects.reduce(
    (sum, effects) => sum + effects.toolCallCount,
    0,
  );
  return (
    <section className="workflow-preview-docket">
      <header>
        <div>
          <span>{copy.previewHash}</span>
          <strong>{preview.previewSha256.slice(0, 16)}</strong>
        </div>
        <dl>
          <div>
            <dt>{copy.reused}</dt>
            <dd>{preview.reusedNodeIds.length}</dd>
          </div>
          <div>
            <dt>{copy.rerun}</dt>
            <dd>{preview.rerunNodeIds.length}</dd>
          </div>
          {preview.schemaVersion !== 1 ? (
            <>
              <div>
                <dt>{copy.executeNow}</dt>
                <dd>{preview.executionNodeIds.length}</dd>
              </div>
              {preview.schemaVersion === 2 || preview.schemaVersion === 5 ? (
                <div>
                  <dt>{copy.stopBefore}</dt>
                  <dd>{preview.stopBeforeNodeIds.length}</dd>
                </div>
              ) : preview.schemaVersion === 3 ? (
                <div>
                  <dt>{copy.simulated}</dt>
                  <dd>1</dd>
                </div>
              ) : preview.schemaVersion === 4 ? (
                <div>
                  <dt>{copy.inputReplaced}</dt>
                  <dd>1</dd>
                </div>
              ) : (
                <div>
                  <dt>{copy.workflowInputReplaced}</dt>
                  <dd>1</dd>
                </div>
              )}
            </>
          ) : null}
        </dl>
      </header>

      <div className="workflow-preview-bindings">
        <span>
          {copy.sourceManifest}
          <code>{preview.sourceManifestSha256.slice(0, 12)}</code>
        </span>
        <span>
          {copy.candidateManifest}
          <code>{preview.candidateManifestSha256.slice(0, 12)}</code>
        </span>
        {preview.schemaVersion === 3 ? (
          <span>
            {copy.simulatedOutput}
            <code>
              {preview.simulatedOutputSha256.slice(0, 12)} /{" "}
              {preview.simulatedOutputBytes} {copy.bytes}
            </code>
          </span>
        ) : null}
        {preview.schemaVersion === 4 ? (
          <span>
            {copy.replacementInput}
            <code>
              {preview.replacementInputSha256.slice(0, 12)} /{" "}
              {preview.replacementInputBytes} {copy.bytes}
            </code>
          </span>
        ) : null}
        {preview.schemaVersion === 6 ? (
          <span>
            {copy.replacementWorkflowInput}
            <code>
              {preview.replacementWorkflowInputSha256.slice(0, 12)} /{" "}
              {preview.replacementWorkflowInputBytes} {copy.bytes}
            </code>
          </span>
        ) : null}
      </div>

      {totalEffects > 0 ? (
        <ol className="workflow-effect-ledger">
          {preview.toolEffects.map((effects) => (
            <li key={effects.nodeId}>
              <strong>{effects.nodeId}</strong>
              <span>
                {copy.calls} {effects.toolCallCount}
              </span>
              <span>
                {copy.readOnly} {effects.readOnlyCount}
              </span>
              <span>
                {copy.writes} {effects.writeCount}
              </span>
              <span>
                {copy.unknown} {effects.unknownCount}
              </span>
              <span>
                {copy.unresolved} {effects.unresolvedCount}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="workflow-effect-empty">{copy.noEffects}</p>
      )}

      <div
        className={`workflow-confirmation ${
          preview.requiresSideEffectConfirmation ? "is-required" : "is-readonly"
        }`}
      >
        <ShieldCheck size={15} aria-hidden="true" />
        <div>
          <strong>{copy.confirmation}</strong>
          <p>
            {preview.requiresSideEffectConfirmation
              ? copy.confirmationRequired
              : copy.confirmationOptional}
          </p>
        </div>
        {preview.requiresSideEffectConfirmation ? (
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled}
              onChange={(event) => onConfirmed(event.target.checked)}
            />
            <span>{copy.confirmCheckbox}</span>
          </label>
        ) : null}
      </div>

      <button
        type="button"
        className="workflow-experiment-run"
        disabled={
          disabled || (preview.requiresSideEffectConfirmation && !confirmed)
        }
        onClick={onExecute}
      >
        <Play size={12} aria-hidden="true" />
        {busy
          ? `${copy.executing} ${streamedFrameCount ? `(${streamedFrameCount})` : ""}`
          : copy.execute}
      </button>
    </section>
  );
}

export function WorkflowExperimentComparisonDocket({
  view,
  result,
  onOpenThread,
  onDownload,
}: {
  view: WorkflowExperimentComparisonView;
  result: ExecutionPlanWorkflowExperimentResultFrame;
  onOpenThread: () => void;
  onDownload: () => void;
}) {
  const metrics = [
    [copy.duration, formatSigned(view.durationMsDelta, "ms")],
    [copy.tokens, formatSigned(view.tokenDelta)],
    [copy.tools, formatSigned(view.toolCallDelta)],
    [copy.cost, formatSigned(view.costUsdDelta, " USD", 6)],
    [copy.evaluations, formatSigned(view.evaluationDelta)],
    [copy.artifacts, formatSigned(view.artifactDelta)],
  ] as const;
  return (
    <section className="workflow-comparison-docket">
      <header>
        <div>
          <span>{copy.comparison}</span>
          <h4>
            {statusLabel(view.sourceStatus)} {"->"}{" "}
            {statusLabel(view.targetStatus)}
          </h4>
        </div>
        <code title={view.comparisonSha256}>
          {view.comparisonSha256.slice(0, 16)}
        </code>
      </header>

      <div className="workflow-comparison-verdict">
        <div>
          <span>{copy.output}</span>
          <strong>{changeLabel(view.outputChange)}</strong>
        </div>
        <div>
          <span>{copy.changedNodes}</span>
          <strong>{view.changedNodeCount}</strong>
        </div>
        <div>
          <span>{copy.reused}</span>
          <strong>{view.reusedNodeCount}</strong>
        </div>
        <div>
          <span>{copy.rerun}</span>
          <strong>{view.rerunNodeCount}</strong>
        </div>
      </div>

      <dl className="workflow-comparison-metrics">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={deltaClass(value)}>{value}</dd>
          </div>
        ))}
      </dl>

      <WorkflowExperimentNodeComparison nodes={view.nodes} />

      <footer>
        <span>
          {copy.targetThread}
          <code>{shortId(result.targetThreadId)}</code>
        </span>
        <div>
          <button type="button" onClick={onDownload}>
            <Download size={12} aria-hidden="true" />
            {copy.download}
          </button>
          <button type="button" className="is-primary" onClick={onOpenThread}>
            {copy.openTarget}
            <ExternalLink size={12} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}
