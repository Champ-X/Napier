import type { ThreadStatus } from "@napier/contracts";

import { copy } from "./copy";

type HeaderModel = {
  configured: boolean;
  id: string;
  key: string;
  provider: string;
};

export function WorkbenchHeader({
  eventCount,
  isRunning,
  model,
  status,
  title,
}: {
  eventCount: number;
  isRunning: boolean;
  model: HeaderModel;
  status: ThreadStatus | undefined;
  title: string;
}) {
  return (
    <header className="workbench-header">
      <div className="thread-heading">
        <span className="folio-number">
          Folio {String(eventCount).padStart(3, "0")}
        </span>
        <h1>{title}</h1>
      </div>
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
      </div>
    </header>
  );
}

function statusLabel(status?: ThreadStatus): string {
  if (status === "failed") return copy.failed;
  if (status === "waiting") return copy.waiting;
  return copy.idle;
}
