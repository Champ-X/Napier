import type { BrowserTaskApiEvent } from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";

export interface BrowserTaskTerminalProps {
  event: Extract<BrowserTaskApiEvent, { type: "completed" | "error" }>;
}

export function BrowserTaskTerminal({ event }: BrowserTaskTerminalProps) {
  if (event.type === "error") {
    return (
      <div className="browser-task-terminal is-error" role="status">
        <strong>{event.message}</strong>
        <p>{event.recovery}</p>
        <small>
          {browserTaskCopy.terminal.diagnostic}{" "}
          {event.diagnosticSha256.slice(0, 16)}
        </small>
      </div>
    );
  }
  const cost =
    event.costStatus === "reported" && event.costUsd !== undefined
      ? `$${event.costUsd.toFixed(6)}`
      : browserTaskCopy.terminal.unknown;
  return (
    <div
      className={`browser-task-terminal status-${event.status}`}
      role="status"
    >
      <strong>
        {browserTaskCopy.terminal.statuses[event.status]} · {event.stepCount}{" "}
        {browserTaskCopy.terminal.steps}
      </strong>
      {event.result ? <p>{event.result}</p> : null}
      <small>
        {browserTaskCopy.terminal.cost} {cost} ·{" "}
        {browserTaskCopy.terminal.artifacts} {event.artifactDirectory}
        {event.backend === "browser_use_cloud"
          ? ` · ${browserTaskCopy.terminal.retentionProviderPlan}`
          : ""}
      </small>
      {event.recovery ? <em>{event.recovery}</em> : null}
    </div>
  );
}
