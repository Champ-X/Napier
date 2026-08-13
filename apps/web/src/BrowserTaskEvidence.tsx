import type { BrowserTaskApiEvent } from "./browser-task-api";

type BrowserTaskStep = Extract<BrowserTaskApiEvent, { type: "step" }>;

export interface BrowserTaskEvidenceProps {
  events: BrowserTaskApiEvent[];
}

export function BrowserTaskEvidence({ events }: BrowserTaskEvidenceProps) {
  const started = events.find(
    (event): event is Extract<BrowserTaskApiEvent, { type: "started" }> =>
      event.type === "started",
  );
  const steps = events.filter(isStep);
  const screenshot = steps.findLast((step) => Boolean(step.screenshotUrl));
  const control = events.findLast((event) => event.type === "control");
  const agentState = browserTaskAgentState(events, control?.state);
  return (
    <>
      {started?.backend === "browser_use_cloud" ? (
        <p className="browser-task-cloud-runtime" role="status">
          Cloud active · credential configured · workspace access none ·
          recording disabled · retention provider-plan · ${started.maxCostUsd}{" "}
          poll-stop ceiling
        </p>
      ) : null}
      {started?.backend === "browser_use_local" ? (
        <p className="browser-task-local-runtime" role="status">
          Local visible {started.browserProduct?.replace("system_", "")}{" "}
          {started.browserVersion} · agent {agentState} ·
          Pause/Take over {started.pauseAvailable ? "ready" : "unavailable"} ·
          CAPTCHA{" "}
          {started.challengeMode === "automatic_takeover_pause"
            ? "auto-takeover"
            : "handoff"}
          {control ? ` · ${control.message}` : ""}
        </p>
      ) : null}
      {screenshot?.screenshotUrl ? (
        <figure className="browser-task-screenshot">
          <img alt="Latest browser task step" src={screenshot.screenshotUrl} />
          <figcaption>
            Step {screenshot.step} · {screenshot.title || screenshot.url}
          </figcaption>
        </figure>
      ) : null}
      {steps.length > 0 ? <BrowserTaskStepList steps={steps} /> : null}
    </>
  );
}

function BrowserTaskStepList({ steps }: { steps: BrowserTaskStep[] }) {
  return (
    <ol className="browser-task-steps" aria-label="Browser task steps">
      {steps.map((step, index) => (
        <li key={`${String(step.step)}-${String(index)}`}>
          <strong>Step {step.step}</strong>
          <span>{step.actionNames.join(", ") || "observe"}</span>
          <small>{step.url}</small>
          {step.errorMessage ? <em>{step.errorMessage}</em> : null}
        </li>
      ))}
    </ol>
  );
}

function isStep(event: BrowserTaskApiEvent): event is BrowserTaskStep {
  return event.type === "step";
}

function browserTaskAgentState(
  events: BrowserTaskApiEvent[],
  controlState: "running" | "paused" | "takeover" | undefined,
): string {
  const terminal = events.findLast(
    (
      event,
    ): event is Extract<
      BrowserTaskApiEvent,
      { type: "completed" | "error" }
    > => event.type === "completed" || event.type === "error",
  );
  if (!terminal) return controlState ?? "running";
  if (terminal.type === "error") {
    return ["cancelled", "server_restarted"].includes(terminal.code)
      ? "stopped"
      : "failed";
  }
  if (terminal.status === "cancelled") return "stopped";
  return terminal.status.replaceAll("_", " ");
}
