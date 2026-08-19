import {
  FlaskConical,
  GitCompareArrows,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResultFrame,
} from "@napier/contracts";

import { agentMessageExperimentCopy as copy } from "./agent-message-experiment-copy";
import {
  agentMessageCheckpoints,
  projectAgentMessageExperimentComparison,
} from "./agent-message-experiment-view-model";
import {
  AgentMessageExperimentComparisonDocket,
  AgentMessageExperimentPreviewDocket,
} from "./AgentMessageExperimentDockets";

type Checkpoint = ReturnType<typeof agentMessageCheckpoints>[number];
type Comparison = ReturnType<typeof projectAgentMessageExperimentComparison>;

export interface AgentMessageExperimentViewProps {
  checkpoints: Checkpoint[];
  checkpoint: Checkpoint | undefined;
  checkpointKey: string;
  replaceModel: boolean;
  reuseToolResults: boolean;
  title: string;
  selectedModelKey: string;
  selectedModelConfigured: boolean;
  preview: AgentMessageExperimentPreview | undefined;
  result: AgentMessageExperimentResultFrame | undefined;
  comparison: Comparison | undefined;
  busy: "preview" | "execute" | undefined;
  running: boolean;
  streamedFrameCount: number;
  error: string | undefined;
  onCheckpointKey(value: string): void;
  onReplaceModel(value: boolean): void;
  onReuseToolResults(value: boolean): void;
  onTitle(value: string): void;
  onInvalidate(): void;
  onPreview(): void;
  onReset(): void;
  onCancel(): void;
  onExecute(): void;
  onOpenThread(): void;
  onDownload(): void;
}

export function AgentMessageExperimentView(
  props: AgentMessageExperimentViewProps,
) {
  const disabled = Boolean(props.busy);
  return (
    <article
      className="agent-experiment-desk"
      aria-labelledby="agent-experiment-title"
      aria-busy={disabled}
    >
      <header className="agent-experiment-heading">
        <div className="agent-experiment-seal" aria-hidden="true">
          <FlaskConical size={17} />
        </div>
        <div>
          <span>{copy.eyebrow}</span>
          <h3 id="agent-experiment-title">{copy.title}</h3>
          <p>{copy.body}</p>
        </div>
        <span className="agent-experiment-folio">
          {props.checkpoint
            ? String(props.checkpoint.messageSeq).padStart(3, "0")
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
                {String(candidate.runIndex).padStart(2, "0")} / #
                {candidate.messageSeq} / {candidate.model.provider}/
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
              !props.checkpoint || !props.selectedModelConfigured || disabled
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
        <label className="agent-experiment-model">
          <input
            type="checkbox"
            checked={props.reuseToolResults}
            disabled={!props.checkpoint || disabled}
            onChange={(event) => {
              props.onReuseToolResults(event.target.checked);
              props.onInvalidate();
            }}
          />
          <span>
            <small>{copy.toolResults}</small>
            <strong>
              {props.reuseToolResults
                ? copy.toolResultsFrozen
                : copy.toolResultsLive}
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
        <AgentMessageExperimentPreviewDocket
          preview={props.preview}
          busy={disabled}
          running={props.running}
          streamedFrameCount={props.streamedFrameCount}
          onCancel={props.onCancel}
          onExecute={props.onExecute}
        />
      ) : null}
      {props.comparison && props.result ? (
        <AgentMessageExperimentComparisonDocket
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
