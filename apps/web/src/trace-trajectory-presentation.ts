import type { TraceTrajectoryEvent } from "./trace-trajectory-model";
import type { TraceTrajectoryDetailField } from "./trace-trajectory-event-detail-view";
import { traceTrajectoryCopy } from "./trace-trajectory-copy";

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

export interface TraceTrajectoryPreviewSection {
  id: string;
  label: string;
  value: string;
  code?: boolean;
  localOnly?: boolean;
}

/** A compact operator-facing sentence, with hashes kept as a fallback only. */
export function traceTrajectoryReadableSummary(
  event: TraceTrajectoryEvent,
): string {
  const previewCopy = traceTrajectoryCopy.detail.previewFields;
  const payload = record(event.event.payload);
  const message = text(payload?.["text"]);
  if (message) return oneLine(message, 280);

  const localText = text(payload?.["localDisplayText"]);
  const localThinking = text(payload?.["localDisplayThinking"]);
  if (event.event.type === "model.response") {
    if (localText) return oneLine(localText, 280);
    const toolNames = toolCallNames(payload?.["toolCalls"]);
    if (toolNames.length > 0) {
      const intent = localThinking ? oneLine(localThinking, 210) : "";
      return [intent, `${previewCopy.calls}: ${toolNames.join(", ")}`]
        .filter(Boolean)
        .join(" · ");
    }
    if (localThinking) return oneLine(localThinking, 280);
  }

  const display = preferredToolDisplay(event.event.type, payload);
  if (display) {
    return displaySummary(display, 280);
  }

  const segments = traceTrajectorySummarySegments(event.summary).filter(
    (segment) =>
      !/\b(?:sha|hash|digest)\b/iu.test(segment) &&
      !/[a-f0-9]{12,}/u.test(segment),
  );
  return oneLine(segments.join(" · ") || event.label, 280);
}

/** Full safe preview blocks for the local inspector. */
export function traceTrajectoryEventPreview(
  event: TraceTrajectoryEvent,
): TraceTrajectoryPreviewSection[] {
  const copy = traceTrajectoryCopy.detail.previewFields;
  const payload = record(event.event.payload);
  const localOnly = payload?.["localDisplaySchemaVersion"] === 1;
  const sections: TraceTrajectoryPreviewSection[] = [];
  const push = (
    id: string,
    label: string,
    value: unknown,
    options: { code?: boolean; local?: boolean } = {},
  ) => {
    const content = displayValue(value);
    if (!content) return;
    sections.push({
      id,
      label,
      value: boundedContent(content),
      ...(options.code ? { code: true } : {}),
      ...(options.local ? { localOnly: true } : {}),
    });
  };

  if (event.event.type.startsWith("message.")) {
    push(
      "message",
      event.role === "USER" ? copy.message : copy.response,
      payload?.["text"],
    );
  }
  if (event.event.type === "model.response") {
    push("thinking", copy.thinking, payload?.["localDisplayThinking"], {
      local: localOnly,
    });
    push("content", copy.modelOutput, payload?.["localDisplayText"], {
      local: localOnly,
    });
    const toolNames = toolCallNames(payload?.["toolCalls"]);
    if (toolNames.length > 0) {
      push("calls", copy.requestedTools, toolNames.join("\n"));
    }
  }
  if (event.event.type.startsWith("tool.")) {
    push("input", copy.input, payload?.["displayInput"], {
      code: true,
      local: payload?.["displaySchemaVersion"] === 1,
    });
    push("output", copy.output, payload?.["displayOutput"], {
      code: true,
      local: payload?.["displaySchemaVersion"] === 1,
    });
    push("error", copy.error, payload?.["displayError"], {
      code: true,
      local: payload?.["displaySchemaVersion"] === 1,
    });
  }
  if (sections.length === 0) {
    push(
      "summary",
      copy.recordedSummary,
      traceTrajectoryReadableSummary(event),
    );
  }
  return sections;
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

function preferredToolDisplay(
  eventType: string,
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (!payload || !eventType.startsWith("tool.")) return undefined;
  if (eventType === "tool.failed") {
    return text(payload["displayError"]) ?? text(payload["displayOutput"]);
  }
  if (eventType === "tool.completed") {
    return text(payload["displayOutput"]) ?? text(payload["displayInput"]);
  }
  return text(payload["displayInput"]);
}

function displaySummary(value: string, maximum: number): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    const parsedRecord = record(parsed);
    if (parsedRecord) {
      const preferred = [
        "path",
        "query",
        "pattern",
        "command",
        "cmd",
        "url",
        "skillName",
        "name",
        "action",
        "target",
        "title",
      ];
      const facts = preferred.flatMap((key) => {
        const candidate = parsedRecord[key];
        if (
          typeof candidate !== "string" &&
          typeof candidate !== "number" &&
          typeof candidate !== "boolean"
        ) {
          return [];
        }
        return [`${humanizeKey(key)}: ${String(candidate)}`];
      });
      if (facts.length > 0)
        return oneLine(facts.slice(0, 3).join(" · "), maximum);
    }
  } catch {
    // Plain text tool output is the normal case.
  }
  return oneLine(value, maximum);
}

function toolCallNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const call = record(candidate);
        return typeof call?.["name"] === "string" ? [call["name"]] : [];
      })
    : [];
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function boundedContent(value: string): string {
  const maximum = 200_000;
  return value.length <= maximum
    ? value
    : `${value.slice(0, maximum)}\n\n[${traceTrajectoryCopy.detail.previewFields.previewTruncated}]`;
}

function oneLine(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function humanizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toLocaleUpperCase());
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
