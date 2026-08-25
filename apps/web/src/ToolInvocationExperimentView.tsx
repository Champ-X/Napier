import { Wrench } from "lucide-react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { toolInvocationExperimentCopy as copy } from "./tool-invocation-experiment-copy";
import {
  ExperimentDeskStatus,
  ExperimentDeskTitleActions,
} from "./ExperimentDeskPrimitives";
import {
  projectToolInvocationExperimentComparison,
  toolInvocationCheckpoints,
} from "./tool-invocation-experiment-view-model";
import {
  ToolInvocationExperimentComparisonDocket,
  ToolInvocationExperimentPreviewDocket,
} from "./ToolInvocationExperimentDockets";

type Checkpoint = ReturnType<typeof toolInvocationCheckpoints>[number];
type Comparison = ReturnType<typeof projectToolInvocationExperimentComparison>;

export interface ToolInvocationExperimentViewProps {
  checkpoints: Checkpoint[];
  checkpoint: Checkpoint | undefined;
  checkpointKey: string;
  title: string;
  preview: ToolInvocationExperimentPreview | undefined;
  result: ToolInvocationExperimentResultFrame | undefined;
  comparison: Comparison | undefined;
  busy: "preview" | "execute" | undefined;
  running: boolean;
  streamedFrameCount: number;
  error: string | undefined;
  onCheckpointKey(value: string): void;
  onTitle(value: string): void;
  onInvalidate(): void;
  onPreview(): void;
  onReset(): void;
  onCancel(): void;
  onExecute(): void;
  onOpenThread(): void;
  onDownload(): void;
}

export function ToolInvocationExperimentView({
  checkpoints,
  checkpoint,
  checkpointKey,
  title,
  preview,
  result,
  comparison,
  busy,
  running,
  streamedFrameCount,
  error,
  onCheckpointKey,
  onTitle,
  onInvalidate,
  onPreview,
  onReset,
  onCancel,
  onExecute,
  onOpenThread,
  onDownload,
}: ToolInvocationExperimentViewProps) {
  const disabled = Boolean(busy);
  return (
    <article
      className="agent-experiment-desk model-experiment-desk tool-experiment-desk"
      aria-labelledby="tool-experiment-title"
      aria-busy={disabled}
    >
      <header className="agent-experiment-heading">
        <div
          className="agent-experiment-seal model-experiment-seal tool-experiment-seal"
          aria-hidden="true"
        >
          <Wrench size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="tool-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="agent-experiment-folio model-experiment-folio">
          {checkpoint ? checkpoint.toolName.slice(0, 12) : "NO CALL"}
        </span>
      </header>
      <div className="agent-experiment-controls tool-experiment-controls">
        <label className="agent-experiment-checkpoint">
          <span>{copy.checkpoint}</span>
          <select
            value={checkpointKey}
            disabled={disabled || checkpoints.length === 0}
            onChange={(event) => {
              onCheckpointKey(event.target.value);
              onInvalidate();
            }}
          >
            <option value="">{copy.selectCheckpoint}</option>
            {checkpoints.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {String(candidate.runIndex).padStart(2, "0")} /{" "}
                {candidate.toolName} / {candidate.status}
              </option>
            ))}
          </select>
        </label>
        <ExperimentDeskTitleActions
          title={title}
          titleLabel={copy.titleLabel}
          titlePlaceholder={copy.titlePlaceholder}
          previewLabel={copy.preview}
          previewingLabel={copy.previewing}
          resetLabel={copy.reset}
          checkpointAvailable={Boolean(checkpoint)}
          previewAvailable={Boolean(preview)}
          resultAvailable={Boolean(result)}
          busy={busy}
          running={running}
          onTitle={onTitle}
          onInvalidate={onInvalidate}
          onPreview={onPreview}
          onReset={onReset}
        />
      </div>
      {!checkpoint && !preview && !result ? (
        <p className="agent-experiment-empty">{copy.empty}</p>
      ) : null}
      {preview ? (
        <ToolInvocationExperimentPreviewDocket
          preview={preview}
          busy={disabled}
          running={running}
          streamedFrameCount={streamedFrameCount}
          onCancel={onCancel}
          onExecute={onExecute}
        />
      ) : null}
      {comparison && result ? (
        <ToolInvocationExperimentComparisonDocket
          result={result}
          comparison={comparison}
          onOpenThread={onOpenThread}
          onDownload={onDownload}
        />
      ) : null}
      <ExperimentDeskStatus error={error} safety={copy.safety} />
    </article>
  );
}
