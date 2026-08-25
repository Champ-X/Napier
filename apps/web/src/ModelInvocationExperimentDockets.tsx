import { GitCompareArrows, RadioTower, ShieldCheck } from "lucide-react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

import { modelInvocationExperimentCopy as copy } from "./model-invocation-experiment-copy";
import type { ModelInvocationExperimentComparisonView } from "./model-invocation-experiment-view-model";
import {
  ExperimentEvidenceReceipt,
  ExperimentMetric,
  ExperimentPreviewFooter,
  ExperimentResultFooter,
} from "./ExperimentDeskPrimitives";

export function ModelInvocationExperimentPreviewDocket({
  preview,
  busy,
  running,
  streamedFrameCount,
  onCancel,
  onExecute,
}: {
  preview: ModelInvocationExperimentPreview;
  busy: boolean;
  running: boolean;
  streamedFrameCount: number;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <section
      className="agent-experiment-preview model-experiment-preview"
      aria-labelledby="model-experiment-preview-title"
    >
      <header>
        <div>
          <span>{copy.previewReady}</span>
          <h4 id="model-experiment-preview-title">
            T{String(preview.sourceTurnIndex).padStart(3, "0")} /{" "}
            {preview.purpose.replaceAll("_", " ")}
          </h4>
        </div>
        <span className="agent-experiment-readonly">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.singleCall}
        </span>
      </header>

      <div className="model-experiment-call-strip">
        <CallSide
          label={copy.source}
          model={`${preview.sourceModel.provider}/${preview.sourceModel.id}`}
          stopReason={preview.sourceStopReason}
        />
        <RadioTower size={14} aria-hidden="true" />
        <CallSide
          label={copy.candidate}
          model={`${preview.targetModel.provider}/${preview.targetModel.id}`}
          stopReason={copy.singleCall}
        />
      </div>

      <dl className="agent-experiment-register model-experiment-register">
        <ExperimentEvidenceReceipt
          label={copy.messages}
          value={String(preview.sourceMessageCount)}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.toolDefinitions}
          value={String(preview.sourceToolCount)}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.contextEnvelope}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.context}
          hash={preview.sourceContextSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.capsule}
          value={`${preview.sourceCapsuleBytes} ${copy.capsuleSize.toLowerCase()}`}
          hash={preview.sourceCapsuleSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.sourceOutput}
          hash={preview.sourceOutputSha256}
        />
      </dl>

      <ExperimentPreviewFooter
        previewSha256={preview.previewSha256}
        previewBindingLabel={copy.previewBinding}
        streamedFrameCount={streamedFrameCount}
        framesLabel={copy.frames}
        busy={busy}
        running={running}
        cancelLabel={copy.cancel}
        executeLabel={copy.execute}
        executeIcon={<RadioTower size={12} aria-hidden="true" />}
        onCancel={onCancel}
        onExecute={onExecute}
      />
    </section>
  );
}

export function ModelInvocationExperimentComparisonDocket({
  result,
  comparison,
  onOpenThread,
  onDownload,
}: {
  result: ModelInvocationExperimentResultFrame;
  comparison: ModelInvocationExperimentComparisonView;
  onOpenThread: () => void;
  onDownload: () => void;
}) {
  return (
    <section
      className="agent-experiment-comparison model-experiment-comparison"
      aria-labelledby="model-experiment-comparison-title"
    >
      <header>
        <div>
          <span>{copy.comparison}</span>
          <h4 id="model-experiment-comparison-title">
            {comparison.sourceStatus} {"->"} {comparison.targetStatus}
          </h4>
        </div>
        <span className={comparison.outputChanged ? "is-changed" : ""}>
          {comparison.outputChanged ? copy.outputChanged : copy.outputUnchanged}
        </span>
      </header>

      <div className="agent-experiment-metrics">
        <ExperimentMetric
          label={copy.duration}
          value={signed(comparison.durationMsDelta, "ms")}
        />
        <ExperimentMetric
          label={copy.tokens}
          value={signed(comparison.tokenDelta)}
        />
        <ExperimentMetric
          label={copy.tools}
          value={signed(comparison.toolCallDelta)}
        />
        <ExperimentMetric
          label={copy.cost}
          value={`${signed(comparison.costUsdDelta, undefined, 6)} USD`}
        />
      </div>

      <div className="agent-experiment-model-delta">
        <CallDelta
          label={copy.source}
          model={comparison.sourceModel}
          stopReason={comparison.sourceStopReason}
        />
        <GitCompareArrows size={14} aria-hidden="true" />
        <CallDelta
          label={copy.candidate}
          model={comparison.targetModel}
          stopReason={comparison.targetStopReason}
        />
      </div>

      <div className="model-experiment-change-grid">
        <ChangeList
          label={copy.addedTools}
          values={comparison.addedToolNames}
        />
        <div className="model-experiment-text-state">
          <span>{copy.textState}</span>
          <strong>
            {comparison.textChanged ? copy.textChanged : copy.textUnchanged}
          </strong>
        </div>
        <ChangeList
          label={copy.removedTools}
          values={comparison.removedToolNames}
        />
      </div>

      <ExperimentResultFooter
        contentSha256={result.contentSha256}
        openLabel={copy.openTarget}
        downloadLabel={copy.download}
        onOpenThread={onOpenThread}
        onDownload={onDownload}
      />
    </section>
  );
}

function CallSide({
  label,
  model,
  stopReason,
}: {
  label: string;
  model: string;
  stopReason: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{model}</strong>
      <small>{stopReason}</small>
    </div>
  );
}

function CallDelta({
  label,
  model,
  stopReason,
}: {
  label: string;
  model: string;
  stopReason: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{model}</strong>
      <small>
        {copy.stopReason}: {stopReason}
      </small>
    </div>
  );
}

function ChangeList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <span>{label}</span>
      {values.length > 0 ? (
        <ul>
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>{copy.none}</p>
      )}
    </div>
  );
}

function signed(value: number, suffix = "", fractionDigits?: number): string {
  const text =
    fractionDigits === undefined
      ? String(value)
      : value.toFixed(fractionDigits);
  return `${value > 0 ? "+" : ""}${text}${suffix}`;
}
