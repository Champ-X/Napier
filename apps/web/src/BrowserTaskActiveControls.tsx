import { Hand, Pause, Play, Square } from "lucide-react";

import { browserTaskCopy } from "./browser-task-copy";
import type { BrowserTaskRunner } from "./use-browser-task-runner";

export interface BrowserTaskActiveControlsProps {
  runner: BrowserTaskRunner;
}

export function BrowserTaskActiveControls({
  runner,
}: BrowserTaskActiveControlsProps) {
  const started = runner.events.find(
    (
      event,
    ): event is Extract<
      import("./browser-task-api").BrowserTaskApiEvent,
      { type: "started" }
    > => event.type === "started" && event.backend === "browser_use_local",
  );
  const localControls =
    runner.created?.backend === "browser_use_local" &&
    started?.pauseAvailable === true &&
    started.takeoverAvailable === true;
  const actions = browserTaskCopy.form.actions;
  return (
    <>
      {localControls && runner.status === "running" ? (
        <button type="button" onClick={() => void runner.pause()}>
          <Pause size={12} fill="currentColor" aria-hidden="true" />
          {actions.pause}
        </button>
      ) : null}
      {localControls && ["paused", "takeover"].includes(runner.status) ? (
        <button type="button" onClick={() => void runner.resume()}>
          <Play size={12} fill="currentColor" aria-hidden="true" />
          {actions.resume}
        </button>
      ) : null}
      {localControls && ["running", "paused"].includes(runner.status) ? (
        <button type="button" onClick={() => void runner.takeover()}>
          <Hand size={12} aria-hidden="true" />
          {actions.takeover}
        </button>
      ) : null}
      <button
        type="button"
        className="danger"
        aria-busy={runner.status === "stopping"}
        disabled={["stopping", "starting"].includes(runner.status)}
        onClick={() => void runner.stop()}
      >
        <Square size={12} fill="currentColor" aria-hidden="true" />
        {runner.status === "stopping" ? actions.stopping : actions.stop}
      </button>
    </>
  );
}
