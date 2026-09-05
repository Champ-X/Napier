import type {
  ModelRouteSideEffectState,
  RouteFailureClass,
} from "@napier/contracts/model-route";

import { structuredRouteFailure } from "./model-route-failure-classification.js";
import { classifyLegacyRouteFailureText } from "./model-route-failure-legacy.js";

const RETRYABLE_FAILURES = new Set<RouteFailureClass>([
  "rate_limited",
  "provider_server",
  "network",
]);
const SAME_CANDIDATE_RETRY_FAILURES = new Set<RouteFailureClass>([
  "provider_server",
  "network",
]);

export function classifyRouteFailure(error: unknown): RouteFailureClass {
  return (
    structuredRouteFailure(error)?.failureClass ??
    classifyLegacyRouteFailureText(routeErrorText(error))
  );
}

export function routeCanFallback(input: {
  failureClass: RouteFailureClass;
  visibleOutputProduced: boolean;
  sideEffectState: ModelRouteSideEffectState;
  hasNextCandidate: boolean;
  aborted: boolean;
}): boolean {
  return (
    !input.aborted &&
    input.hasNextCandidate &&
    !input.visibleOutputProduced &&
    input.sideEffectState === "none" &&
    RETRYABLE_FAILURES.has(input.failureClass)
  );
}

export function routeCanRetrySameCandidate(input: {
  failureClass: RouteFailureClass;
  visibleOutputProduced: boolean;
  sideEffectState: ModelRouteSideEffectState;
  hasRetryAttempt: boolean;
  aborted: boolean;
}): boolean {
  return (
    !input.aborted &&
    input.hasRetryAttempt &&
    !input.visibleOutputProduced &&
    input.sideEffectState === "none" &&
    SAME_CANDIDATE_RETRY_FAILURES.has(input.failureClass)
  );
}

export function cooldownDurationMs(failureClass: RouteFailureClass): number {
  if (failureClass === "rate_limited") return 60_000;
  if (failureClass === "provider_server") return 15_000;
  if (failureClass === "network") return 5_000;
  return 0;
}

export function routeErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record["errorMessage"] ?? record["message"];
    if (typeof message === "string") return message;
  }
  return String(error);
}
