import { FlaskConical, GitCompareArrows, LockKeyhole } from "lucide-react";

import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
} from "@napier/contracts";

import { agentMessageExperimentCopy as copy } from "./agent-message-experiment-copy";
import type { AgentMessageExperimentComparisonView } from "./agent-message-experiment-view-model";
import {
  ExperimentEvidenceReceipt,
  ExperimentMetric,
  ExperimentPreviewFooter,
  ExperimentResultFooter,
} from "./ExperimentDeskPrimitives";

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
        <ExperimentEvidenceReceipt
          label={copy.history}
          value={String(preview.sourceHistoryMessageCount)}
          hash={preview.sourceHistorySha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.workspace}
          value={`${preview.candidateWorkspaceFileCount} ${copy.workspaceFiles} / ${preview.candidateWorkspaceBytes} ${copy.workspaceBytes}`}
          hash={preview.candidateWorkspaceSnapshotSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.promptBinding}
          hash={preview.sourcePromptSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.memoryBinding}
          hash={preview.sourceMemoryContextSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.skillBinding}
          hash={preview.sourceSkillCatalogSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.configurationBinding}
          hash={preview.sourceRunConfigurationSha256}
        />
        <ExperimentEvidenceReceipt
          label={copy.toolResultBinding}
          value={`${preview.toolResultMode} / ${preview.sourceReusableToolResultCount} ${copy.reusableResults}`}
          hash={preview.sourceToolResultSetSha256}
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
        executeIcon={<FlaskConical size={12} aria-hidden="true" />}
        onCancel={onCancel}
        onExecute={onExecute}
      />
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
        <ExperimentMetric
          label={copy.reusedResults}
          value={`${result.experiment.toolResultReuse.reusedResultCount}/${result.experiment.toolResultReuse.sourceResultCount} / ${result.experiment.toolResultReuse.divergenceCount} ${copy.divergence}`}
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
