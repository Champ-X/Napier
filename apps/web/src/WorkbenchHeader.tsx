import type { ModelSummary, ThreadStatus } from "@napier/contracts";
import type { ReactNode } from "react";
import { Settings2, Wrench } from "lucide-react";

import { copy } from "./copy";
import { ModelPicker } from "./ModelPicker";

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
  contextLabel,
  children,
  taskStatus,
  recommendedModelKeys,
  recentModelKeys,
  onModel,
  onOpenDeveloperWorkbench,
  onOpenSettings,
}: {
  isRunning: boolean;
  model: HeaderModel;
  models: readonly ModelSummary[];
  status: ThreadStatus | undefined;
  title: string;
  contextLabel: string;
  children?: ReactNode;
  taskStatus?: ReactNode;
  recommendedModelKeys?: readonly string[];
  recentModelKeys?: readonly string[];
  onModel(value: string): void;
  onOpenDeveloperWorkbench(): void;
  onOpenSettings(): void;
}) {
  return (
    <header className="workbench-header">
      <div className="thread-heading">
        {title ? (
          <h1 title={`${contextLabel} · ${title}`}>{title}</h1>
        ) : (
          <span className="thread-heading-idle">
            <strong>{copy.appName}</strong>
            <small>{copy.appDescriptor}</small>
          </span>
        )}
      </div>
      {children}
      <div className="run-meta">
        {taskStatus ?? (
          <div
            className={`run-status ${isRunning ? "is-running" : ""}`}
            role="status"
            aria-live="polite"
          >
            <span />
            {isRunning ? copy.running : statusLabel(status)}
          </div>
        )}
        <ModelPicker
          models={models}
          value={model.key}
          label={copy.settingsSurface.contextSection}
          disabled={isRunning}
          variant="compact"
          recommendedModelKeys={recommendedModelKeys}
          recentModelKeys={recentModelKeys}
          onChange={onModel}
        />
        <button
          className="workbench-settings workbench-developer"
          type="button"
          onClick={onOpenDeveloperWorkbench}
          aria-label={copy.developerWorkbench.open}
          title={copy.developerWorkbench.open}
        >
          <Wrench size={15} aria-hidden="true" />
        </button>
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
