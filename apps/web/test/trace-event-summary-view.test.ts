import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  traceEventSummaryView,
  traceSummaryCoverageView,
} from "../src/trace-event-summary-view";

describe("Trace event summary view", () => {
  it("classifies bounded, fixed, category, and generic summaries", () => {
    const bounded = traceEventSummaryView(
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
        text: "TOP_SECRET_USER_TEXT",
      }),
    );
    const fixed = traceEventSummaryView(
      traceEvent("message.user", "message", ["TOP_SECRET_USER_TEXT"]),
    );
    const category = traceEventSummaryView(
      traceEvent("message.future", "message", {
        text: "TOP_SECRET_FUTURE_MESSAGE",
      }),
    );
    const generic = traceEventSummaryView(
      traceEvent("custom.audit", "system", {
        summary: "TOP_SECRET_GENERIC_SUMMARY",
      }),
    );

    expect(bounded).toEqual({
      text: "message / message.user / role user / text-bytes 20",
      source: "bounded",
    });
    expect(fixed).toEqual({ text: "message receipt", source: "fixed" });
    expect(category).toEqual({ text: "message", source: "category" });
    expect(generic).toEqual({
      text: "TOP_SECRET_GENERIC_SUMMARY",
      source: "generic",
    });
  });

  it("aggregates coverage and generic event types deterministically", () => {
    const coverage = traceSummaryCoverageView([
      traceEvent("message.user", "message", {
        role: "user",
        textBytes: 24,
      }),
      traceEvent("message.user", "message", []),
      traceEvent("message.future", "message", {
        text: "TOP_SECRET_FUTURE_MESSAGE",
      }),
      traceEvent("zeta.audit", "system", {
        summary: "TOP_SECRET_ZETA",
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA",
      }),
      traceEvent("alpha.audit", "system", {
        status: "TOP_SECRET_ALPHA_DUPLICATE",
      }),
    ]);

    expect(coverage).toEqual({
      total: 6,
      bounded: 1,
      fixed: 1,
      category: 1,
      generic: 3,
      genericEventTypes: ["alpha.audit", "zeta.audit"],
    });
  });
});

function traceEvent(
  type: string,
  category: RunEvent["category"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_trace",
    runId: "run_trace",
    seq: 51,
    type,
    category,
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
