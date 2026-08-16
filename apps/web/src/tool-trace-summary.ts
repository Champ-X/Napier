import type { RunEvent } from "@napier/contracts";

import { toolDeadlineEventTraceSummary } from "./tool-deadline-event-view";
import { toolEventTraceSummary } from "./tool-event-view";

export function toolTraceSummary(event: RunEvent): string | undefined {
  return event.type === "tool.deadline.exceeded" ||
    event.type === "tool.cancellation.settled"
    ? toolDeadlineEventTraceSummary(event)
    : toolEventTraceSummary(event);
}
