import {
  GitCompareArrows,
  RadioTower,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type {
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResultFrame,
} from "@napier/contracts";

import { modelInvocationExperimentCopy as copy } from "./model-invocation-experiment-copy";
import {
  modelInvocationCheckpoints,
  projectModelInvocationExperimentComparison,
} from "./model-invocation-experiment-view-model";
import {
  ModelInvocationExperimentComparisonDocket,
  ModelInvocationExperimentPreviewDocket,
} from "./ModelInvocationExperimentDockets";

type Checkpoint = ReturnType<typeof modelInvocationCheckpoints>[number];
type Comparison = ReturnType<typeof projectModelInvocationExperimentComparison>;

export interface ModelInvocationExperimentViewProps {
  checkpoints: Checkpoint[];
  checkpoint: Checkpoint | undefined;
  checkpointKey: string;
  replaceModel: boolean;
  title: string;
  selectedModelKey: string;
  selectedModelEligible: boolean;
  preview: ModelInvocationExperimentPreview | undefined;
  result: ModelInvocationExperimentResultFrame | undefined;
  comparison: Comparison | undefined;
  busy: "preview" | "execute" | undefined;
  running: boolean;
  streamedFrameCount: number;
  error: string | undefined;
  onCheckpointKey(value: string): void;
  onReplaceModel(value: boolean): void;
  onTitle(value: string): void;
  onInvalidate(): void;
  onPreview(): void;
  onReset(): void;
  onCancel(): void;
  onExecute(): void;
  onOpenThread(): void;
  onDownload(): void;
}

export function ModelInvocationExperimentView(
  props: ModelInvocationExperimentViewProps,
) {
  const disabled = Boolean(props.busy);
  return (
    <article
      className="agent-experiment-desk model-experiment-desk"
      aria-labelledby="model-experiment-title"
      aria-busy={disabled}
    >
      <header className="agent-experiment-heading">
        <div
          className="agent-experiment-seal model-experiment-seal"
          aria-hidden="true"
        >
          <RadioTower size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="model-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="agent-experiment-folio model-experiment-folio">
          {props.checkpoint
            ? String(props.checkpoint.turnIndex).padStart(3, "0")
            : "---"}
        </span>
      </header>
      <div className="agent-experiment-controls">
        <label className="agent-experiment-checkpoint">
          <span>{copy.checkpoint}</span>
          <select
            value={props.checkpointKey}
            disabled={disabled || props.checkpoints.length === 0}
            onChange={(event) => {
              props.onCheckpointKey(event.target.value);
              props.onInvalidate();
            }}
          >
            <option value="">{copy.selectCheckpoint}</option>
            {props.checkpoints.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {String(candidate.runIndex).padStart(2, "0")} /{" "}
                {candidate.purpose} / {candidate.model.provider}/
                {candidate.model.id} / {candidate.status}
              </option>
            ))}
          </select>
        </label>
        <label className="agent-experiment-model">
          <input
            type="checkbox"
            checked={props.replaceModel}
            disabled={
              !props.checkpoint || !props.selectedModelEligible || disabled
            }
            onChange={(event) => {
              props.onReplaceModel(event.target.checked);
              props.onInvalidate();
            }}
          />
          <span>
            <small>{copy.modelOverride}</small>
            <strong>
              {props.replaceModel ? props.selectedModelKey : copy.modelOriginal}
            </strong>
          </span>
        </label>
        <label className="agent-experiment-title-field">
          <span>{copy.titleLabel}</span>
          <input
            type="text"
            value={props.title}
            maxLength={100}
            placeholder={copy.titlePlaceholder}
            disabled={disabled}
            onChange={(event) => {
              props.onTitle(event.target.value);
              props.onInvalidate();
            }}
          />
        </label>
        <div className="agent-experiment-actions">
          <button
            type="button"
            disabled={!props.checkpoint || props.running || disabled}
            onClick={props.onPreview}
          >
            <GitCompareArrows size={12} aria-hidden="true" />
            {props.busy === "preview" ? copy.previewing : copy.preview}
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={disabled || (!props.preview && !props.result)}
            onClick={props.onReset}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {copy.reset}
          </button>
        </div>
      </div>
      {!props.checkpoint && !props.preview && !props.result ? (
        <p className="agent-experiment-empty">{copy.empty}</p>
      ) : null}
      {props.preview ? (
        <ModelInvocationExperimentPreviewDocket
          preview={props.preview}
          busy={disabled}
          running={props.running}
          streamedFrameCount={props.streamedFrameCount}
          onCancel={props.onCancel}
          onExecute={props.onExecute}
        />
      ) : null}
      {props.comparison && props.result ? (
        <ModelInvocationExperimentComparisonDocket
          result={props.result}
          comparison={props.comparison}
          onOpenThread={props.onOpenThread}
          onDownload={props.onDownload}
        />
      ) : null}
      {props.error ? (
        <p className="agent-experiment-error" role="alert">
          {props.error}
        </p>
      ) : null}
      <p className="agent-experiment-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {copy.safety}
      </p>
    </article>
  );
}
