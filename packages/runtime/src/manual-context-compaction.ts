import type { RunEvent } from "@napier/contracts";

import {
  contextContinuityEvidenceEvents,
  contextContinuityEventsCharacterCount,
} from "./context-continuity-evidence.js";
import {
  contextEventText,
  contextMessageEvents,
  type ContextProjectionPlan,
} from "./compaction.js";

export function planManualContextCompaction(
  events: RunEvent[],
  retainedMessageCount: number,
): ContextProjectionPlan {
  if (
    !Number.isSafeInteger(retainedMessageCount) ||
    retainedMessageCount < 2 ||
    retainedMessageCount > 24
  ) {
    throw new Error("Retained message count must be between 2 and 24");
  }
  const messages = contextMessageEvents(events);
  if (messages.length <= retainedMessageCount) {
    throw new Error("Context compaction requires more source messages");
  }
  const recentEvents = messages.slice(-retainedMessageCount);
  const retainedFromSeq = recentEvents[0]!.seq;
  const compactEvents = messages.filter((event) => event.seq < retainedFromSeq);
  if (compactEvents.length === 0) {
    throw new Error("Context compaction has no source messages");
  }
  const fromSeq = compactEvents[0]!.seq;
  const toSeq = compactEvents.at(-1)!.seq;
  const compactContinuityEvents = contextContinuityEvidenceEvents(
    events,
  ).filter((event) => event.seq >= fromSeq && event.seq <= toSeq);
  return {
    compactEvents,
    deltaEvents: compactEvents,
    compactContinuityEvents,
    deltaContinuityEvents: compactContinuityEvents,
    recentEvents,
    needsCompaction: true,
    sourceCharacters:
      compactEvents.reduce(
        (total, event) => total + contextEventText(event).length,
        0,
      ) + contextContinuityEventsCharacterCount(compactContinuityEvents),
  };
}
