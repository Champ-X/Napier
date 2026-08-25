import {
  Download,
  ExternalLink,
  GitCompareArrows,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ExperimentDeskOperation } from "./use-experiment-desk-lifecycle";

export function ExperimentDeskTitleActions(props: {
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  previewLabel: string;
  previewingLabel: string;
  resetLabel: string;
  checkpointAvailable: boolean;
  previewAvailable: boolean;
  resultAvailable: boolean;
  busy: ExperimentDeskOperation | undefined;
  running: boolean;
  onTitle(value: string): void;
  onInvalidate(): void;
  onPreview(): void;
  onReset(): void;
}) {
  const disabled = Boolean(props.busy);
  return (
    <>
      <label className="agent-experiment-title-field">
        <span>{props.titleLabel}</span>
        <input
          type="text"
          value={props.title}
          maxLength={100}
          placeholder={props.titlePlaceholder}
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
          disabled={!props.checkpointAvailable || props.running || disabled}
          onClick={props.onPreview}
        >
          <GitCompareArrows size={12} aria-hidden="true" />
          {props.busy === "preview"
            ? props.previewingLabel
            : props.previewLabel}
        </button>
        <button
          type="button"
          className="is-secondary"
          disabled={
            disabled || (!props.previewAvailable && !props.resultAvailable)
          }
          onClick={props.onReset}
        >
          <RotateCcw size={12} aria-hidden="true" />
          {props.resetLabel}
        </button>
      </div>
    </>
  );
}

export function ExperimentDeskStatus({
  error,
  safety,
}: {
  error: string | undefined;
  safety: string;
}) {
  return (
    <>
      {error ? (
        <p className="agent-experiment-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="agent-experiment-safety">
        <ShieldCheck size={12} aria-hidden="true" />
        {safety}
      </p>
    </>
  );
}

export function ExperimentEvidenceReceipt({
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

export function ExperimentMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ExperimentPreviewFooter(props: {
  previewSha256: string;
  previewBindingLabel: string;
  streamedFrameCount: number;
  framesLabel: string;
  busy: boolean;
  running: boolean;
  cancelLabel: string;
  executeLabel: string;
  executeIcon: ReactNode;
  onCancel(): void;
  onExecute(): void;
}) {
  return (
    <footer>
      <code title={props.previewSha256}>
        {props.previewBindingLabel} {props.previewSha256.slice(0, 12)}
      </code>
      {props.streamedFrameCount > 0 ? (
        <span>
          {props.streamedFrameCount} {props.framesLabel}
        </span>
      ) : null}
      {props.busy ? (
        <button type="button" className="is-secondary" onClick={props.onCancel}>
          {props.cancelLabel}
        </button>
      ) : (
        <button
          type="button"
          disabled={props.running}
          onClick={props.onExecute}
        >
          {props.executeIcon}
          {props.executeLabel}
        </button>
      )}
    </footer>
  );
}

export function ExperimentResultFooter(props: {
  contentSha256: string;
  openLabel: string;
  downloadLabel: string;
  onOpenThread(): void;
  onDownload(): void;
}) {
  return (
    <footer>
      <code title={props.contentSha256}>
        {props.contentSha256.slice(0, 12)}
      </code>
      <button type="button" onClick={props.onOpenThread}>
        <ExternalLink size={12} aria-hidden="true" />
        {props.openLabel}
      </button>
      <button type="button" className="is-secondary" onClick={props.onDownload}>
        <Download size={12} aria-hidden="true" />
        {props.downloadLabel}
      </button>
    </footer>
  );
}
