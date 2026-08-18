import type { ModelSummary, ThreadStatus } from "@napier/contracts";
import type { ReactNode } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

import { copy } from "./copy";
import { configuredModelProviderGroups } from "./model-selection-view-model";

type HeaderModel = {
  configured: boolean;
  id: string;
  key: string;
  provider: string;
};

export function WorkbenchHeader({
  isRunning,
  model,
  models,
  status,
  title,
  children,
  onModel,
  onOpenSettings,
}: {
  isRunning: boolean;
  model: HeaderModel;
  models: readonly ModelSummary[];
  status: ThreadStatus | undefined;
  title: string;
  children?: ReactNode;
  onModel(value: string): void;
  onOpenSettings(): void;
}) {
  const modelGroups = configuredModelProviderGroups(models);
  return (
    <header className="workbench-header">
      <div className="thread-heading">
        {title ? (
          <h1>{title}</h1>
        ) : (
          <span className="thread-heading-idle">
            <strong>{copy.appName}</strong>
            <small>{copy.appDescriptor}</small>
          </span>
        )}
      </div>
      {children}
      <div className="run-meta">
        <label
          className={`model-chip ${model.configured ? "" : "is-unavailable"}`}
          title={
            model.configured
              ? model.key
              : `${model.key} · ${copy.modelUnavailable}`
          }
        >
          <span className="model-glyph" aria-hidden="true">
            {model.provider === "napier"
              ? "D"
              : model.provider.slice(0, 1).toUpperCase()}
          </span>
          <span className="model-chip-copy">
            <small>
              {!model.configured
                ? copy.modelUnavailable
                : model.provider === "napier"
                  ? copy.context.demoProvider
                  : copy.context.liveProvider}
            </small>
            <strong>{model.id}</strong>
          </span>
          <ChevronDown
            className="model-chip-chevron"
            size={12}
            aria-hidden="true"
          />
          <select
            aria-label={copy.settingsSurface.contextSection}
            value={model.key}
            disabled={isRunning}
            onChange={(event) => onModel(event.target.value)}
          >
            {modelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div
          className={`run-status ${isRunning ? "is-running" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span />
          {isRunning ? copy.running : statusLabel(status)}
        </div>
        <button
          className="workbench-settings"
          type="button"
          onClick={onOpenSettings}
          aria-label={copy.settings}
        >
          <Settings2 size={15} aria-hidden="true" />
          <kbd>⌘,</kbd>
        </button>
      </div>
    </header>
  );
}

function statusLabel(status?: ThreadStatus): string {
  if (status === "failed") return copy.failed;
  if (status === "waiting") return copy.waiting;
  return copy.idle;
}
