import type { RouteFailureClass } from "@napier/contracts/model-route";

import { routeFailureClassFromHttpStatus } from "./model-route-http-status.js";

const FAILURE_CLASSES = new Set<RouteFailureClass>([
  "rate_limited",
  "provider_server",
  "network",
  "context",
  "authentication",
  "billing",
  "tool_dialect",
  "cancelled",
  "unknown",
]);

const NETWORK_CODES = new Set([
  "eai_again",
  "econnrefused",
  "econnreset",
  "enotfound",
  "etimedout",
  "und_err_connect_timeout",
  "und_err_headers_timeout",
  "und_err_socket",
]);
const CONTEXT_CODES = new Set([
  "context_length_exceeded",
  "max_tokens_exceeded",
  "prompt_too_long",
]);
const AUTHENTICATION_CODES = new Set([
  "authentication_error",
  "invalid_api_key",
  "permission_denied",
]);
const BILLING_CODES = new Set([
  "billing_hard_limit_reached",
  "credit_balance_exhausted",
  "insufficient_quota",
]);
const RATE_LIMIT_CODES = new Set([
  "rate_limit_error",
  "rate_limit_exceeded",
  "too_many_requests",
]);
const TOOL_DIALECT_CODES = new Set([
  "invalid_tool_call",
  "invalid_tool_schema",
  "tool_choice_unsupported",
  "tool_schema_unsupported",
]);
const ABORT_CODES = new Set(["abort_err", "aborted", "cancelled", "canceled"]);

export interface ModelRouteFailureSignalV1 {
  readonly kind: "napier.model-route-failure-signal";
  readonly schemaVersion: 1;
  readonly failureClass: RouteFailureClass;
}

export class ModelRouteFailureError extends Error {
  override readonly name = "ModelRouteFailureError";
  readonly routeFailure: ModelRouteFailureSignalV1;

  constructor(
    message: string,
    failureClass: RouteFailureClass,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.routeFailure = Object.freeze({
      kind: "napier.model-route-failure-signal" as const,
      schemaVersion: 1 as const,
      failureClass,
    });
  }
}

export interface StructuredRouteFailure {
  readonly failureClass: RouteFailureClass;
  readonly source: "typed" | "structured";
}

/** Resolves only locale-independent evidence. An invalid typed signal is terminal unknown. */
export function structuredRouteFailure(
  error: unknown,
): StructuredRouteFailure | undefined {
  return structuredRouteFailureInner(error, new Set<object>(), 0);
}

export function hasProviderAbortEvidence(error: unknown): boolean {
  const resolved = structuredRouteFailure(error);
  return resolved?.failureClass === "cancelled";
}

function structuredRouteFailureInner(
  error: unknown,
  visited: Set<object>,
  depth: number,
): StructuredRouteFailure | undefined {
  const value = record(error);
  if (!value || depth > 4 || visited.has(value)) return undefined;
  visited.add(value);

  if (Object.prototype.hasOwnProperty.call(value, "routeFailure")) {
    return {
      failureClass: typedFailureClass(value["routeFailure"]) ?? "unknown",
      source: "typed",
    };
  }
  if (value["kind"] === "napier.model-route-failure-signal") {
    return {
      failureClass: typedFailureClass(value) ?? "unknown",
      source: "typed",
    };
  }

  const status = httpStatus(value);
  const statusClass = routeFailureClassFromHttpStatus(status);
  if (statusClass) return { failureClass: statusClass, source: "structured" };

  const tokens = [value["code"], value["type"], value["errorType"]]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim().toLowerCase());
  for (const token of tokens) {
    const tokenClass = tokenFailureClass(token);
    if (tokenClass) return { failureClass: tokenClass, source: "structured" };
  }
  if (
    value["name"] === "AbortError" ||
    value["stopReason"] === "aborted" ||
    value["stop_reason"] === "aborted"
  ) {
    return { failureClass: "cancelled", source: "structured" };
  }

  const cause = structuredRouteFailureInner(value["cause"], visited, depth + 1);
  return cause;
}

function typedFailureClass(value: unknown): RouteFailureClass | undefined {
  const signal = record(value);
  const failureClass = signal?.["failureClass"];
  return signal?.["kind"] === "napier.model-route-failure-signal" &&
    signal["schemaVersion"] === 1 &&
    typeof failureClass === "string" &&
    FAILURE_CLASSES.has(failureClass as RouteFailureClass) &&
    Object.keys(signal).every((key) =>
      ["kind", "schemaVersion", "failureClass"].includes(key),
    )
    ? (failureClass as RouteFailureClass)
    : undefined;
}

function httpStatus(value: Record<string, unknown>): number | undefined {
  const direct = value["status"] ?? value["statusCode"];
  if (Number.isSafeInteger(direct)) return Number(direct);
  const response = record(value["response"]);
  const nested = response?.["status"] ?? response?.["statusCode"];
  return Number.isSafeInteger(nested) ? Number(nested) : undefined;
}

function tokenFailureClass(token: string): RouteFailureClass | undefined {
  if (ABORT_CODES.has(token)) return "cancelled";
  if (NETWORK_CODES.has(token)) return "network";
  if (CONTEXT_CODES.has(token)) return "context";
  if (AUTHENTICATION_CODES.has(token)) return "authentication";
  if (BILLING_CODES.has(token)) return "billing";
  if (RATE_LIMIT_CODES.has(token)) return "rate_limited";
  if (TOOL_DIALECT_CODES.has(token)) return "tool_dialect";
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
