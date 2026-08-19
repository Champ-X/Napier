import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Inbox,
  LoaderCircle,
} from "lucide-react";

import { copy } from "./copy";

const COLORS = [
  "accent",
  "success",
  "warning",
  "danger",
  "surface",
  "muted",
] as const;

type ShowcaseCopy = typeof copy.settingsSurface.designShowcase;

export interface DesignSystemShowcaseProps {}

export function DesignSystemShowcase({}: DesignSystemShowcaseProps) {
  const showcase = copy.settingsSurface.designShowcase;
  return (
    <section
      className="design-showcase"
      aria-labelledby="design-showcase-title"
    >
      <header>
        <span>{showcase.tokenEyebrow}</span>
        <h2 id="design-showcase-title">{copy.settingsSurface.designSection}</h2>
        <p>{copy.settingsSurface.designSectionDescription}</p>
      </header>

      <DesignColors showcase={showcase} />
      <DesignTypography showcase={showcase} />
      <DesignControls showcase={showcase} />
      <DesignStates showcase={showcase} />
      <DesignEmptyState showcase={showcase} />
    </section>
  );
}

export interface DesignSectionProps {
  showcase: ShowcaseCopy;
}

function DesignColors({ showcase }: DesignSectionProps) {
  return (
    <section aria-labelledby="design-colors-title">
      <h3 id="design-colors-title">{showcase.colors}</h3>
      <div className="design-color-grid">
        {COLORS.map((color) => (
          <article className={`design-color is-${color}`} key={color}>
            <i aria-hidden="true" />
            <strong>{showcase.colorLabels[color]}</strong>
            <code>--color-{color}</code>
          </article>
        ))}
      </div>
    </section>
  );
}

function DesignTypography({ showcase }: DesignSectionProps) {
  return (
    <section aria-labelledby="design-type-title">
      <h3 id="design-type-title">{showcase.typography}</h3>
      <div className="design-type-stack">
        <p className="is-heading">{showcase.headingSample}</p>
        <p className="is-body">{showcase.bodySample}</p>
        <code>{showcase.technicalSample}</code>
      </div>
    </section>
  );
}

function DesignControls({ showcase }: DesignSectionProps) {
  return (
    <section aria-labelledby="design-controls-title">
      <h3 id="design-controls-title">{showcase.controls}</h3>
      <div className="design-control-row">
        <button className="task-primary-action" type="button">
          {showcase.primaryAction}
        </button>
        <button className="design-secondary-action" type="button">
          {showcase.secondaryAction}
        </button>
        <button className="task-primary-action" type="button" disabled>
          {showcase.disabledAction}
        </button>
      </div>
      <label className="design-field">
        <span>{showcase.taskName}</span>
        <input defaultValue={showcase.taskNameValue} />
        <small>{showcase.fieldHelp}</small>
      </label>
    </section>
  );
}

function DesignStates({ showcase }: DesignSectionProps) {
  return (
    <section aria-labelledby="design-states-title">
      <h3 id="design-states-title">{showcase.states}</h3>
      <div className="design-state-grid">
        <State
          icon={CircleDot}
          tone="ready"
          label={showcase.stateLabels.ready}
        />
        <State
          icon={LoaderCircle}
          tone="working"
          label={showcase.stateLabels.working}
        />
        <State
          icon={AlertTriangle}
          tone="warning"
          label={showcase.stateLabels.waiting}
        />
        <State
          icon={AlertTriangle}
          tone="danger"
          label={showcase.stateLabels.failed}
        />
        <State
          icon={CheckCircle2}
          tone="success"
          label={showcase.stateLabels.completed}
        />
      </div>
    </section>
  );
}

function DesignEmptyState({ showcase }: DesignSectionProps) {
  return (
    <section
      className="design-empty-state"
      aria-label={showcase.emptyStateLabel}
    >
      <Inbox size={24} aria-hidden="true" />
      <strong>{showcase.emptyStateTitle}</strong>
      <p>{showcase.emptyStateBody}</p>
    </section>
  );
}

export interface DesignStateProps {
  icon: typeof CircleDot;
  tone: string;
  label: string;
}

function State({ icon: Icon, tone, label }: DesignStateProps) {
  return (
    <article className={`design-state is-${tone}`}>
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
    </article>
  );
}
