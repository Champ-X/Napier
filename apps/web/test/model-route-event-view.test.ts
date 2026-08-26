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
      sourceModelId: "claude-source",
      endpointProfileId: "corp_gateway",
      endpointKind: "gateway",
      dialect: "anthropic_messages",
      credentialPoolId: "anthropic_pool",
      credentialSlotId: "slot_public_hash",
      credentialHealth: "healthy",
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
      sourceModelId: "claude-source",
      endpointProfileId: "corp_gateway",
      endpointKind: "gateway",
      dialect: "anthropic_messages",
      credentialPoolId: "anthropic_pool",
      credentialSlotId: "slot_public_hash",
      credentialHealth: "healthy",
      fallbackReason: "rate_limited",
      visibleOutputProduced: false,
      sideEffectState: "none",
      contentSha256: "a".repeat(64),
    });
    expect(modelRouteEventTraceSummary(event)).toContain(
      "serving anthropic/claude-sonnet-4-6",
    );
    expect(modelRouteEventTraceSummary(event)).toContain(
      "fallback rate_limited",
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
      providerHint: "regional capacity",
      retryAfterMs: 2_000,
      backoffMs: 1_800,
      visibleOutputProduced: false,
      sideEffectState: "none",
      durationMs: 91,
      diagnosticSha256: "TOP_SECRET_DIAGNOSTIC",
      contentSha256: "b".repeat(64),
    });

    expect(modelRouteEventTraceSummary(event)).toContain(
      "serving openai/gpt-5.4 / outcome retryable / failure network",
    );
    expect(modelRouteEventTraceSummary(event)).toContain(
      "provider-hint regional capacity / retry-after-ms 2000 / backoff-ms 1800",
    );
    expect(modelRouteEventTraceSummary(event)).not.toContain("TOP_SECRET");
    expect(traceTrajectoryTerminalEvent(event)).toBe(true);
  });

  it("shows the resolved path and candidate chain without projecting arbitrary fields", () => {
    const event = routeEvent("route_plan_created", {
      role: "reasoning",
      path: "workflow",
      resolutionSource: "path",
      candidates: [
        { providerId: "openai", modelId: "gpt-5.4" },
        { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
        { providerId: "unsafe", modelId: "bad model", secret: "TOP_SECRET" },
      ],
      contentSha256: "c".repeat(64),
    });

    expect(modelRouteEventTraceView(event)).toEqual({
      action: "plan.created",
      role: "reasoning",
      path: "workflow",
      resolutionSource: "path",
      candidateCount: 3,
      candidateChain: "openai/gpt-5.4 > anthropic/claude-sonnet-4-6",
      contentSha256: "c".repeat(64),
    });
    expect(modelRouteEventTraceSummary(event)).not.toContain("TOP_SECRET");
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
