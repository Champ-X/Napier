import { GitCompareArrows, RotateCcw, ShieldCheck, Wrench } from "lucide-react";

import type {
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";

import { toolInvocationExperimentCopy as copy } from "./tool-invocation-experiment-copy";
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
        <label className="agent-experiment-title-field">
          <span>{copy.titleLabel}</span>
          <input
            type="text"
            value={title}
            maxLength={100}
            placeholder={copy.titlePlaceholder}
            disabled={disabled}
            onChange={(event) => {
              onTitle(event.target.value);
              onInvalidate();
            }}
          />
        </label>
        <div className="agent-experiment-actions">
          <button
            type="button"
            disabled={!checkpoint || running || disabled}
            onClick={onPreview}
          >
            <GitCompareArrows size={12} aria-hidden="true" />
            {busy === "preview" ? copy.previewing : copy.preview}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={disabled || (!preview && !result)}
            onClick={onReset}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.reset}
          </button>
        </div>
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
      {error ? (
        <p className="agent-experiment-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="agent-experiment-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.safety}
      </p>
    </article>
  );
}
