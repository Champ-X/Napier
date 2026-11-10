import type { RunEvent } from "@napier/contracts";

/**
 * Live SSE frames only need full conversation projections when the event can
 * change the operator-visible surface. Debug lifecycle noise still streams the
 * raw event so trajectory stays complete without paying 12 projectors per tick.
 */
export function streamEventNeedsProjections(event: RunEvent): boolean {
  switch (event.category) {
    case "message":
    case "tool":
    case "artifact":
    case "plan":
    case "goal":
    case "subagent":
    case "model":
      return true;
    case "lifecycle":
      return (
        event.type === "run.started" ||
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.cancelled" ||
        event.type === "run.interrupted" ||
        event.type === "run.waiting_for_operator" ||
        event.type === "run.recovery.started" ||
        event.type === "run.recovery.completed" ||
        event.type === "run.recovery.failed" ||
        event.type.startsWith("operator.")
      );
    default:
      return event.type.startsWith("operator.");
  }
}
