import type { RouteFailureClass } from "@napier/contracts/model-route";

import { hostModelAbortProvenance } from "./model-abort-provenance.js";
import { hasProviderAbortEvidence } from "./model-route-failure-classification.js";
import { classifyRouteFailure } from "./model-route-policy.js";

export const MAX_INLINE_RETRY_DELAY_MS = 1_000;

export interface ModelRouteResponseHints {
  providerHint?: string;
  retryAfterMs?: number;
}

export function routeFailureHints(error: unknown): ModelRouteResponseHints {
  if (!error || typeof error !== "object") return {};
  const record = error as Record<string, unknown>;
  const headers = normalizedHeaders(
    record["headers"] && typeof record["headers"] === "object"
      ? (record["headers"] as Record<string, unknown>)
      : {},
  );
  const retryAfter = record["retryAfterMs"] ?? headers["retry-after-ms"];
  const retryAfterMs =
    retryAfter !== undefined
      ? parseMilliseconds(retryAfter)
      : parseRetryAfterHeader(headers["retry-after"]);
  const hint =
    record["providerHint"] ??
    headers["x-provider-hint"] ??
    headers["x-ratelimit-scope"];
  const providerHint = safeProviderHint(hint);
  return {
    ...(providerHint ? { providerHint } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function routeResponseHints(
  headers: Record<string, string>,
): ModelRouteResponseHints {
  const normalized = normalizedHeaders(headers);
  const providerHint = safeProviderHint(
    normalized["x-provider-hint"] ?? normalized["x-ratelimit-scope"],
  );
  const retryAfterMs =
    parseMilliseconds(normalized["retry-after-ms"]) ??
    parseRetryAfterHeader(normalized["retry-after"]);
  return {
    ...(providerHint ? { providerHint } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

export function classifyRouteAttemptFailure(
  error: unknown,
  rootSignalAborted: boolean,
): RouteFailureClass {
  if (rootSignalAborted || hostModelAbortProvenance(error)) return "cancelled";
  const failureClass = classifyRouteFailure(error);
  return failureClass === "cancelled" && hasProviderAbortEvidence(error)
    ? "network"
    : failureClass;
}

function parseMilliseconds(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return Math.min(300_000, Math.round(numeric));
}

function parseRetryAfterHeader(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(300_000, Math.round(seconds * 1_000));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.min(300_000, Math.max(0, timestamp - Date.now()))
    : undefined;
}

function normalizedHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function safeProviderHint(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._:/ -]{1,120}$/u.test(value)
    ? value
    : undefined;
}
