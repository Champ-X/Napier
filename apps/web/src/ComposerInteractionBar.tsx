import { Activity, CirclePause } from "lucide-react";

import { copy } from "./copy";
import { composerCopy } from "./composer-copy";

export type ComposerInteractionState =
  | "idle"
  | "running"
  | "decision"
  | "browser";

export interface ComposerInteractionBarProps {
  state: ComposerInteractionState;
  mode: "steering" | "follow_up";
  onMode(mode: "steering" | "follow_up"): void;
}

export function ComposerInteractionBar({
  state,
  mode,
  onMode,
}: ComposerInteractionBarProps) {
  if (state === "idle") return null;
  const t = composerCopy.interaction;
  const running = state === "running";
  const Icon = running ? Activity : CirclePause;
  const hint =
    state === "decision"
      ? t.decisionHint
      : state === "browser"
        ? t.browserHint
        : mode === "steering"
          ? t.steeringHint
          : t.followUpHint;
  return (
    <div className="composer-interaction-bar">
      <div className="composer-interaction-heading">
        <span className="composer-interaction-status" role="status">
          <Icon size={14} aria-hidden="true" />
          {t[state]}
        </span>
        {running ? (
          <select
            className="composer-interaction-mode"
            aria-label={copy.controlMode}
            aria-describedby="composer-interaction-hint"
            value={mode}
            onChange={(event) =>
              onMode(
                event.target.value === "follow_up" ? "follow_up" : "steering",
              )
            }
          >
            <option value="steering">{t.steering}</option>
            <option value="follow_up">{t.followUp}</option>
          </select>
        ) : null}
      </div>
      <p id="composer-interaction-hint">{hint}</p>
    </div>
  );
}

export function composerInteractionState({
  decisionPending,
  browserConfirmationPending,
  running,
}: {
  decisionPending: boolean;
  browserConfirmationPending: boolean;
  running: boolean;
}): ComposerInteractionState {
  if (decisionPending) return "decision";
  if (browserConfirmationPending) return "browser";
  return running ? "running" : "idle";
}

export function composerInteractionPlaceholder(
  state: ComposerInteractionState,
  mode: "steering" | "follow_up",
): string {
  const t = composerCopy.interaction;
  if (state === "decision") return t.decisionPlaceholder;
  if (state === "browser") return t.browserPlaceholder;
  if (state === "idle") return copy.composerPlaceholder;
  return mode === "steering" ? t.steeringPlaceholder : t.followUpPlaceholder;
}
