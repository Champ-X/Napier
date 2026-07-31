import {
  Download,
  ExternalLink,
  FlaskConical,
  GitCompareArrows,
  LockKeyhole,
} from "lucide-react";

import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
} from "@napier/contracts";

import { agentMessageExperimentCopy as copy } from "./agent-message-experiment-copy";
import type { AgentMessageExperimentComparisonView } from "./agent-message-experiment-view-model";

export function AgentMessageExperimentPreviewDocket({
  preview,
  busy,
  running,
  streamedFrameCount,
  onCancel,
  onExecute,
}: {
  preview: AgentMessageExperimentPreview;
  busy: boolean;
  running: boolean;
  streamedFrameCount: number;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <section
      className="agent-experiment-preview"
      aria-labelledby="agent-experiment-preview-title"
    >
      <header>
        <div>
          <span>{copy.previewReady}</span>
          <h4 id="agent-experiment-preview-title">
            {copy.source} #{preview.sourceMessageSeq} {"->"} {copy.candidate}
          </h4>
        </div>
        <span className="agent-experiment-readonly">
          <LockKeyhole size={11} aria-hidden="true" />
          {copy.readOnly}
        </span>
      </header>
      <div className="agent-experiment-sides">
        <EvidenceSide
          label={copy.source}
          model={`${preview.sourceModel.provider}/${preview.sourceModel.id}`}
          tools={[
            `${preview.sourceToolEffects.readOnlyCount} ${copy.reads}`,
            `${preview.sourceToolEffects.writeCount} ${copy.writes}`,
            `${preview.sourceToolEffects.unknownCount} ${copy.unknown}`,
          ]}
        />
        <EvidenceSide
          label={copy.candidate}
          model={`${preview.targetModel.provider}/${preview.targetModel.id}`}
          tools={preview.targetToolNames}
        />
      </div>
      <dl className="agent-experiment-register">
        <EvidenceReceipt
          label={copy.history}
          value={String(preview.sourceHistoryMessageCount)}
          hash={preview.sourceHistorySha256}
        />
        <EvidenceReceipt
          label={copy.workspace}
          value={`${preview.candidateWorkspaceFileCount} ${copy.workspaceFiles} / ${preview.candidateWorkspaceBytes} ${copy.workspaceBytes}`}
          hash={preview.candidateWorkspaceSnapshotSha256}
        />
        <EvidenceReceipt
          label={copy.promptBinding}
          hash={preview.sourcePromptSha256}
        />
        <EvidenceReceipt
          label={copy.memoryBinding}
          hash={preview.sourceMemoryContextSha256}
        />
        <EvidenceReceipt
          label={copy.skillBinding}
          hash={preview.sourceSkillCatalogSha256}
        />
        <EvidenceReceipt
          label={copy.configurationBinding}
          hash={preview.sourceRunConfigurationSha256}
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
            <FlaskConical size={12} aria-hidden="true" />
            {copy.execute}
          </button>
        )}
      </footer>
    </section>
  );
}

export function AgentMessageExperimentComparisonDocket({
  result,
  comparison,
  onOpenThread,
  onDownload,
}: {
  result: AgentMessageExperimentResultFrame;
  comparison: AgentMessageExperimentComparisonView;
  onOpenThread: () => void;
  onDownload: () => void;
}) {
  return (
    <section
      className="agent-experiment-comparison"
      aria-labelledby="agent-experiment-comparison-title"
    >
      <header>
        <div>
          <span>{copy.comparison}</span>
          <h4 id="agent-experiment-comparison-title">
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
        <div>
          <span>{copy.source}</span>
          <strong>{comparison.sourceModel}</strong>
        </div>
        <GitCompareArrows size={14} aria-hidden="true" />
        <div>
          <span>{copy.candidate}</span>
          <strong>{comparison.targetModel}</strong>
        </div>
      </div>
      <div className="agent-experiment-change-grid">
        <ChangeList
          label={copy.configuration}
          values={comparison.changedConfigurationFields}
          empty={copy.noConfigurationChanges}
        />
        <ChangeList
          label={copy.addedTools}
          values={comparison.addedToolNames}
          empty={copy.none}
        />
        <ChangeList
          label={copy.removedTools}
          values={comparison.removedToolNames}
          empty={copy.none}
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

function EvidenceSide({
  label,
  model,
  tools,
}: {
  label: string;
  model: string;
  tools: string[];
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{model}</strong>
      <small>{tools.length > 0 ? tools.join(" / ") : copy.noTools}</small>
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

function ChangeList({
  label,
  values,
  empty,
}: {
  label: string;
  values: string[];
  empty: string;
}) {
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
        <p>{empty}</p>
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
