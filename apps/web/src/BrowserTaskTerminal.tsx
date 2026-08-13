import type { BrowserTaskApiEvent } from "./browser-task-api";

export interface BrowserTaskTerminalProps {
  event: Extract<BrowserTaskApiEvent, { type: "completed" | "error" }>;
}

export function BrowserTaskTerminal({ event }: BrowserTaskTerminalProps) {
  if (event.type === "error") {
    return (
      <div className="browser-task-terminal is-error" role="status">
        <strong>{event.message}</strong>
        <p>{event.recovery}</p>
        <small>Diagnostic {event.diagnosticSha256.slice(0, 16)}</small>
      </div>
    );
  }
  const cost =
    event.costStatus === "reported" && event.costUsd !== undefined
      ? `$${event.costUsd.toFixed(6)}`
      : "unknown";
  return (
    <div
      className={`browser-task-terminal status-${event.status}`}
      role="status"
    >
      <strong>
        {event.status.replaceAll("_", " ")} · {event.stepCount} steps
      </strong>
      {event.result ? <p>{event.result}</p> : null}
      <small>
        Cost {cost} · Artifacts {event.artifactDirectory}
        {event.backend === "browser_use_cloud"
          ? " · Retention provider-plan"
          : ""}
      </small>
      {event.recovery ? <em>{event.recovery}</em> : null}
    </div>
  );
}
