import type { TraceTrajectoryEvent } from "./trace-trajectory-model";
import type { TraceTrajectoryDetailField } from "./trace-trajectory-event-detail-view";

const GENERIC_SUMMARY_PREFIXES = new Set([
  "agent",
  "artifact",
  "context",
  "evaluation",
  "message",
  "model",
  "plan",
  "run",
  "tool",
  "workflow",
]);

export function traceTrajectorySummarySegments(summary: string): string[] {
  const segments = summary
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (
    segments.length > 1 &&
    GENERIC_SUMMARY_PREFIXES.has(segments[0]!.toLowerCase())
  ) {
    segments.shift();
  }
  if (segments.length <= 6) return segments;
  return [...segments.slice(0, 5), `+${String(segments.length - 5)}`];
}

export function traceTrajectoryEventHighlights(
  event: TraceTrajectoryEvent,
  evidence: TraceTrajectoryDetailField[],
): TraceTrajectoryDetailField[] {
  const preferred = [
    "model",
    "toolName",
    "action",
    "stopReason",
    "inputTokens",
    "outputTokens",
    "toolCallCount",
    "outputTextBytes",
    "outputBytes",
    "status",
    "effect",
  ];
  const ranked = preferred
    .map((key) => evidence.find((field) => field.key === key))
    .filter((field): field is TraceTrajectoryDetailField => Boolean(field));
  if (ranked.length >= 3) return ranked.slice(0, 4);
  const fallback: TraceTrajectoryDetailField[] = [
    { key: "eventType", value: event.event.type },
    { key: "category", value: event.event.category },
    {
      key: "turn",
      value: event.turnIndex === 0 ? "setup" : String(event.turnIndex),
    },
    ...(event.callOrdinal === undefined
      ? []
      : [{ key: "call", value: `C${String(event.callOrdinal)}` }]),
  ];
  const seen = new Set(ranked.map((field) => field.key));
  return [...ranked, ...fallback.filter((field) => !seen.has(field.key))].slice(
    0,
    4,
  );
}
