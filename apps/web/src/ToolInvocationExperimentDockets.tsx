import { GitCompareArrows, ShieldCheck, Wrench } from "lucide-react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { toolInvocationExperimentCopy as copy } from "./tool-invocation-experiment-copy";
import type { ToolInvocationExperimentComparisonView } from "./tool-invocation-experiment-view-model";
import {
  ExperimentEvidenceReceipt,
  ExperimentMetric,
  ExperimentPreviewFooter,
  ExperimentResultFooter,
} from "./ExperimentDeskPrimitives";

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
        <ExperimentEvidenceReceipt
          label={copy.definition}
          hash={preview.sourceToolDefinitionSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.arguments}
          hash={preview.sourceArgumentsSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.workspace}
          value={`${preview.candidateWorkspaceFileCount} files / ${preview.candidateWorkspaceBytes} bytes`}
          hash={preview.candidateWorkspaceSnapshotSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.capsule}
          value={`${preview.sourceCapsuleBytes} bytes`}
          hash={preview.sourceCapsuleSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.sourceOutput}
          value={`${preview.sourceOutputBytes} bytes`}
          hash={preview.sourceOutputSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.sourceDuration}
          value={`${preview.sourceDurationMs} ms`}
          hash={preview.previewSha256}
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
        executeIcon={<Wrench size={12} aria-hidden="true" />}
        onCancel={onCancel}
        onExecute={onExecute}
      />
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
        <ExperimentMetric
          label={copy.duration}
          value={signed(comparison.durationMsDelta, "ms")}
        />
        <ExperimentMetric
          label={copy.bytes}
          value={signed(comparison.outputBytesDelta, " B")}
        />
        <ExperimentMetric
          label={copy.sourceBytes}
          value={`${comparison.sourceOutputBytes} B`}
        />
        <ExperimentMetric
          label={copy.targetBytes}
          value={`${comparison.targetOutputBytes} B`}
        />
      </div>

      <div className="tool-experiment-identity">
        <Wrench size={14} aria-hidden="true" />
        <span>{comparison.toolName}</span>
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

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${String(value)}${suffix}`;
}
