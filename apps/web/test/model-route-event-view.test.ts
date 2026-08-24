import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelRouteEventTraceSummary,
  modelRouteEventTraceView,
} from "../src/model-route-event-view";
import { traceEventSummaryView } from "../src/trace-event-summary-view";
import {
  traceTrajectoryCallKey,
  traceTrajectoryIsKeyEvent,
  traceTrajectoryStartEvent,
  traceTrajectoryTerminalEvent,
} from "../src/trace-trajectory-events";

describe("Model route event view", () => {
  it("shows serving model, fallback reason, and attempt without secrets", () => {
    const event = routeEvent("route_attempt_started", {
      routePlanId: "route_12345678",
      attemptId: "route_attempt_12345678",
      attempt: 2,
      stepAttempt: 2,
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      credentialSlotId: "slot_public_hash",
      credentialSecret: "TOP_SECRET_CREDENTIAL",
      fallbackReason: "rate_limited",
      visibleOutputProduced: false,
      sideEffectState: "none",
      contentSha256: "a".repeat(64),
    });

    expect(modelRouteEventTraceView(event)).toEqual({
      action: "attempt.started",
      attempt: 2,
      stepAttempt: 2,
      servingModel: "anthropic/claude-sonnet-4-6",
      fallbackReason: "rate_limited",
      visibleOutputProduced: false,
      sideEffectState: "none",
      contentSha256: "a".repeat(64),
    });
    expect(modelRouteEventTraceSummary(event)).toContain(
      "serving anthropic/claude-sonnet-4-6 / fallback rate_limited",
    );
    expect(modelRouteEventTraceSummary(event)).not.toContain("TOP_SECRET");
    expect(traceEventSummaryView(event).source).toBe("bounded");
    expect(traceTrajectoryIsKeyEvent({ event })).toBe(true);
    expect(traceTrajectoryStartEvent(event)).toBe(true);
    expect(traceTrajectoryCallKey(event)).toBe(
      "route:run_route_12345678:route_attempt_12345678",
    );
  });

  it("pairs an ended attempt and exposes its terminal evidence", () => {
    const event = routeEvent("route_attempt_ended", {
      attemptId: "route_attempt_12345678",
      attempt: 1,
      stepAttempt: 1,
      providerId: "openai",
      modelId: "gpt-5.4",
      outcome: "retryable",
      failureClass: "network",
      visibleOutputProduced: false,
      sideEffectState: "none",
      durationMs: 91,
      diagnosticSha256: "TOP_SECRET_DIAGNOSTIC",
      contentSha256: "b".repeat(64),
    });

    expect(modelRouteEventTraceSummary(event)).toContain(
      "serving openai/gpt-5.4 / outcome retryable / failure network",
    );
    expect(modelRouteEventTraceSummary(event)).not.toContain("TOP_SECRET");
    expect(traceTrajectoryTerminalEvent(event)).toBe(true);
  });
});

function routeEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type}`,
    threadId: "thread_route_12345678",
    runId: "run_route_12345678",
    seq: 7,
    type,
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}
