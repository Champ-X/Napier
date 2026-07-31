import {
  Download,
  ExternalLink,
  GitCompareArrows,
  RadioTower,
  ShieldCheck,
} from "lucide-react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

import { modelInvocationExperimentCopy as copy } from "./model-invocation-experiment-copy";
import type { ModelInvocationExperimentComparisonView } from "./model-invocation-experiment-view-model";

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
        <EvidenceReceipt
          label={copy.messages}
          value={String(preview.sourceMessageCount)}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <EvidenceReceipt
          label={copy.toolDefinitions}
          value={String(preview.sourceToolCount)}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <EvidenceReceipt
          label={copy.contextEnvelope}
          hash={preview.sourceContextEnvelopeSha256}
        />
        <EvidenceReceipt
          label={copy.context}
          hash={preview.sourceContextSha256}
        />
        <EvidenceReceipt
          label={copy.capsule}
          value={`${preview.sourceCapsuleBytes} ${copy.capsuleSize.toLowerCase()}`}
          hash={preview.sourceCapsuleSha256}
        />
        <EvidenceReceipt
          label={copy.sourceOutput}
          hash={preview.sourceOutputSha256}
        />
      </dl>

      <footer>
        <code title={preview.previewSha256}>
          {copy.previewBinding} {preview.previewSha256.slice(0, 12)}
        </code>
        {streamedFrameCount > 0 ? (
          <span>
            {streamedFrameCount} {copy.frames}
          </span>
        ) : null}
        {busy ? (
          <button type="button" className="is-secondary" onClick={onCancel}>
            {copy.cancel}
          </button>
        ) : (
          <button type="button" disabled={running} onClick={onExecute}>
            <RadioTower size={12} aria-hidden="true" />
            {copy.execute}
          </button>
        )}
      </footer>
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
        <Metric
          label={copy.duration}
          value={signed(comparison.durationMsDelta, "ms")}
        />
        <Metric label={copy.tokens} value={signed(comparison.tokenDelta)} />
        <Metric label={copy.tools} value={signed(comparison.toolCallDelta)} />
        <Metric
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

      <footer>
        <code title={result.contentSha256}>
          {result.contentSha256.slice(0, 12)}
        </code>
        <button type="button" onClick={onOpenThread}>
          <ExternalLink size={12} aria-hidden="true" />
          {copy.openTarget}
        </button>
        <button type="button" className="is-secondary" onClick={onDownload}>
          <Download size={12} aria-hidden="true" />
          {copy.download}
        </button>
      </footer>
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

function EvidenceReceipt({
  label,
  value,
  hash,
}: {
  label: string;
  value?: string;
  hash: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? hash.slice(0, 12)}</dd>
      {value ? <code title={hash}>{hash.slice(0, 12)}</code> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
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
