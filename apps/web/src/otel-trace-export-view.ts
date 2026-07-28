import type { RunEvent } from "@napier/contracts";

export interface OpenTelemetryTraceExportView {
  scope: OpenTelemetryTraceExportScope;
  spanCount: number;
  eventAnchorSetSha256?: string;
}

export type OpenTelemetryTraceExportScope = "run" | "thread";

const SHA256 = /^[a-f0-9]{64}$/u;
const TRACE_EXPORT_RECEIPT_SUMMARY = "trace export receipt";

export function openTelemetryTraceExportView(
  event: RunEvent,
): OpenTelemetryTraceExportView | undefined {
  if (
    event.type !== "trace.otlp.exported" ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const scope = event.payload["scope"];
  const spanCount = event.payload["spanCount"];
  const eventAnchorSetSha256 = event.payload["eventAnchorSetSha256"];
  if (
    !isOpenTelemetryTraceExportScope(scope) ||
    !Number.isSafeInteger(spanCount) ||
    Number(spanCount) < 0
  ) {
    return undefined;
  }
  return {
    scope,
    spanCount: Number(spanCount),
    ...(typeof eventAnchorSetSha256 === "string" &&
    SHA256.test(eventAnchorSetSha256)
      ? { eventAnchorSetSha256 }
      : {}),
  };
}

export function openTelemetryTraceExportSummary(
  event: RunEvent,
): string | undefined {
  if (event.type !== "trace.otlp.exported") return undefined;
  const view = openTelemetryTraceExportView(event);
  if (!view) return TRACE_EXPORT_RECEIPT_SUMMARY;
  return view.eventAnchorSetSha256
    ? `${view.scope} / ${view.spanCount} spans / anchor ${view.eventAnchorSetSha256.slice(0, 12)}`
    : `${view.scope} / ${view.spanCount} spans`;
}

function isOpenTelemetryTraceExportScope(
  value: unknown,
): value is OpenTelemetryTraceExportScope {
  return value === "run" || value === "thread";
}
