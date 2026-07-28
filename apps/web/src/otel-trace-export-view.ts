import type { RunEvent } from "@napier/contracts";

export interface OpenTelemetryTraceExportView {
  scope: string;
  spanCount: number;
  eventAnchorSetSha256?: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;

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
    typeof scope !== "string" ||
    !scope ||
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
  const view = openTelemetryTraceExportView(event);
  if (!view) return undefined;
  return view.eventAnchorSetSha256
    ? `${view.scope} / ${view.spanCount} spans / anchor ${view.eventAnchorSetSha256.slice(0, 12)}`
    : `${view.scope} / ${view.spanCount} spans`;
}
