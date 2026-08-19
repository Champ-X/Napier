import type { BrowserTaskApiEvent } from "./browser-task-api";
import { browserTaskCopy } from "./browser-task-copy";

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
          {browserTaskCopy.evidence.cloudActive} ·{" "}
          {browserTaskCopy.evidence.credentialConfigured} ·{" "}
          {browserTaskCopy.evidence.workspaceAccessNone} ·{" "}
          {browserTaskCopy.evidence.recordingDisabled} ·{" "}
          {browserTaskCopy.evidence.retentionProviderPlan} · $
          {started.maxCostUsd} {browserTaskCopy.evidence.pollStopCeiling}
        </p>
      ) : null}
      {started?.backend === "browser_use_local" ? (
        <p className="browser-task-local-runtime" role="status">
          {browserTaskCopy.evidence.localVisible}{" "}
          {started.browserProduct?.replace("system_", "")}{" "}
          {started.browserVersion} · {browserTaskCopy.evidence.agent}{" "}
          {agentState} · {browserTaskCopy.evidence.controls}{" "}
          {started.pauseAvailable
            ? browserTaskCopy.evidence.ready
            : browserTaskCopy.evidence.unavailable}{" "}
          · {browserTaskCopy.evidence.captcha}{" "}
          {started.challengeMode === "automatic_takeover_pause"
            ? browserTaskCopy.evidence.automaticTakeover
            : browserTaskCopy.evidence.handoff}
          {control ? ` · ${control.message}` : ""}
        </p>
      ) : null}
      {screenshot?.screenshotUrl ? (
        <figure className="browser-task-screenshot">
          <img
            alt={browserTaskCopy.evidence.latestStepAlt}
            src={screenshot.screenshotUrl}
          />
          <figcaption>
            {browserTaskCopy.evidence.step} {screenshot.step} ·{" "}
            {screenshot.title || screenshot.url}
          </figcaption>
        </figure>
      ) : null}
      {steps.length > 0 ? <BrowserTaskStepList steps={steps} /> : null}
    </>
  );
}

export interface BrowserTaskStepListProps {
  steps: BrowserTaskStep[];
}

function BrowserTaskStepList({ steps }: BrowserTaskStepListProps) {
  return (
    <ol
      className="browser-task-steps"
      aria-label={browserTaskCopy.evidence.steps}
    >
      {steps.map((step, index) => (
        <li key={`${String(step.step)}-${String(index)}`}>
          <strong>
            {browserTaskCopy.evidence.step} {step.step}
          </strong>
          <span>
            {step.actionNames.join(", ") || browserTaskCopy.evidence.observe}
          </span>
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
    ): event is Extract<BrowserTaskApiEvent, { type: "completed" | "error" }> =>
      event.type === "completed" || event.type === "error",
  );
  if (!terminal) {
    return browserTaskCopy.evidence.agentStates[controlState ?? "running"];
  }
  if (terminal.type === "error") {
    return ["cancelled", "server_restarted"].includes(terminal.code)
      ? browserTaskCopy.evidence.agentStates.stopped
      : browserTaskCopy.evidence.agentStates.failed;
  }
  if (terminal.status === "cancelled") {
    return browserTaskCopy.evidence.agentStates.stopped;
  }
  return browserTaskCopy.evidence.agentStates[terminal.status];
}
