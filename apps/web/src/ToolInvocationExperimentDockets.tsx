import {
  Download,
  ExternalLink,
  GitCompareArrows,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { toolInvocationExperimentCopy as copy } from "./tool-invocation-experiment-copy";
import type { ToolInvocationExperimentComparisonView } from "./tool-invocation-experiment-view-model";

export function ToolInvocationExperimentPreviewDocket({
  preview,
  busy,
  running,
  streamedFrameCount,
  onCancel,
  onExecute,
}: {
  preview: ToolInvocationExperimentPreview;
  busy: boolean;
  running: boolean;
  streamedFrameCount: number;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <section
      className="agent-experiment-preview model-experiment-preview tool-experiment-preview"
      aria-labelledby="tool-experiment-preview-title"
    >
      <header>
        <div>
          <span>{copy.previewReady}</span>
          <h4 id="tool-experiment-preview-title">{preview.sourceToolName}</h4>
        </div>
        <span className="agent-experiment-readonly">
          <ShieldCheck size={11} aria-hidden="true" />
          {copy.readOnly}
        </span>
      </header>

      <div className="model-experiment-call-strip tool-experiment-call-strip">
        <CallSide
          label={copy.source}
          status="completed"
          detail={`${preview.sourceOutputBytes} bytes`}
        />
        <GitCompareArrows size={14} aria-hidden="true" />
        <CallSide
          label={copy.candidate}
          status="pending"
          detail={`${preview.candidateWorkspaceFileCount} scoped files`}
        />
      </div>

      <dl className="agent-experiment-register model-experiment-register">
        <EvidenceReceipt
          label={copy.definition}
          hash={preview.sourceToolDefinitionSha256}
        />
        <EvidenceReceipt
          label={copy.arguments}
          hash={preview.sourceArgumentsSha256}
        />
        <EvidenceReceipt
          label={copy.workspace}
          value={`${preview.candidateWorkspaceFileCount} files / ${preview.candidateWorkspaceBytes} bytes`}
          hash={preview.candidateWorkspaceSnapshotSha256}
        />
        <EvidenceReceipt
          label={copy.capsule}
          value={`${preview.sourceCapsuleBytes} bytes`}
          hash={preview.sourceCapsuleSha256}
        />
        <EvidenceReceipt
          label={copy.sourceOutput}
          value={`${preview.sourceOutputBytes} bytes`}
          hash={preview.sourceOutputSha256}
        />
        <EvidenceReceipt
          label={copy.sourceDuration}
          value={`${preview.sourceDurationMs} ms`}
          hash={preview.previewSha256}
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
            <Wrench size={12} aria-hidden="true" />
            {copy.execute}
          </button>
        )}
      </footer>
    </section>
  );
}

export function ToolInvocationExperimentComparisonDocket({
  result,
  comparison,
  onOpenThread,
  onDownload,
}: {
  result: ToolInvocationExperimentResultFrame;
  comparison: ToolInvocationExperimentComparisonView;
  onOpenThread: () => void;
  onDownload: () => void;
}) {
  return (
    <section
      className="agent-experiment-comparison model-experiment-comparison tool-experiment-comparison"
      aria-labelledby="tool-experiment-comparison-title"
    >
      <header>
        <div>
          <span>{copy.comparison}</span>
          <h4 id="tool-experiment-comparison-title">
            {comparison.sourceStatus} {"->"} {comparison.targetStatus}
          </h4>
        </div>
        <span className={comparison.outputChanged ? "is-changed" : ""}>
          {comparison.outputChanged ? copy.outputChanged : copy.outputUnchanged}
        </span>
      </header>

      <div className="agent-experiment-metrics tool-experiment-metrics">
        <Metric
          label={copy.duration}
          value={signed(comparison.durationMsDelta, "ms")}
        />
        <Metric
          label={copy.bytes}
          value={signed(comparison.outputBytesDelta, " B")}
        />
        <Metric
          label={copy.sourceBytes}
          value={`${comparison.sourceOutputBytes} B`}
        />
        <Metric
          label={copy.targetBytes}
          value={`${comparison.targetOutputBytes} B`}
        />
      </div>

      <div className="tool-experiment-identity">
        <Wrench size={14} aria-hidden="true" />
        <span>{comparison.toolName}</span>
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
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{status}</strong>
      <small>{detail}</small>
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

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${String(value)}${suffix}`;
}
