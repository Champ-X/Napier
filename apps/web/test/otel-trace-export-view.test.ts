import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  openTelemetryTraceExportSummary,
  openTelemetryTraceExportView,
} from "../src/otel-trace-export-view";

describe("OpenTelemetry trace export view", () => {
  it("projects only hash-only exported trace receipt metadata", () => {
    const event = traceExportEvent({
      scope: "thread",
      spanCount: 4,
      eventAnchorSetSha256: "a".repeat(64),
      prompt: "TOP_SECRET_PROMPT",
      completion: "TOP_SECRET_COMPLETION",
    });

    expect(openTelemetryTraceExportView(event)).toEqual({
      scope: "thread",
      spanCount: 4,
      eventAnchorSetSha256: "a".repeat(64),
    });
    expect(openTelemetryTraceExportSummary(event)).toBe(
      `thread / 4 spans / anchor ${"a".repeat(12)}`,
    );
    expect(openTelemetryTraceExportSummary(event)).not.toContain("TOP_SECRET");
  });

  it("keeps legacy export receipts readable without an anchor hash", () => {
    expect(
      openTelemetryTraceExportSummary(
        traceExportEvent({ scope: "run", spanCount: 2 }),
      ),
    ).toBe("run / 2 spans");
  });

  it("rejects malformed trace export receipt projections", () => {
    expect(
      openTelemetryTraceExportView(
        traceExportEvent({
          scope: "thread",
          spanCount: 4,
          eventAnchorSetSha256: "not-a-hash",
        }),
      ),
    ).toEqual({
      scope: "thread",
      spanCount: 4,
    });
    expect(
      openTelemetryTraceExportView(
        traceExportEvent({ scope: "thread", spanCount: -1 }),
      ),
    ).toBeUndefined();
  });
});

function traceExportEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_otel",
    threadId: "thread_otel",
    runId: "runctl_otel",
    seq: 12,
    type: "trace.otlp.exported",
    category: "system",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
