import type { ThreadStatus } from "@napier/contracts";
import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";

import { copy } from "./copy";

type HeaderModel = {
  configured: boolean;
  id: string;
  key: string;
  provider: string;
};

export function WorkbenchHeader({
  isRunning,
  model,
  status,
  title,
  children,
  onOpenSettings,
}: {
  isRunning: boolean;
  model: HeaderModel;
  status: ThreadStatus | undefined;
  title: string;
  children?: ReactNode;
  onOpenSettings(): void;
}) {
  return (
    <header className="workbench-header">
      <div className="thread-heading">
        <h1>{title}</h1>
      </div>
      {children}
      <div className="run-meta">
        <div
          className={`model-chip ${model.configured ? "" : "is-unavailable"}`}
          title={
            model.configured
              ? model.key
              : `${model.key} · ${copy.modelUnavailable}`
          }
        >
          <span className="model-glyph" aria-hidden="true">
            {model.provider === "napier" ? "D" : "L"}
          </span>
          <span>
            <small>
              {!model.configured
                ? copy.modelUnavailable
                : model.provider === "napier"
                  ? copy.context.demoProvider
                  : copy.context.liveProvider}
            </small>
            <strong>{model.id}</strong>
          </span>
        </div>
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
