import type { ToolFailureModeV1 } from "@napier/contracts/tool-protocol";

import {
  declaredFailureMode,
  resolveDeclaredToolFailure,
  structuredTransportFailureClass,
  ToolFailureError,
  toolFailureDefinitionForDeclaration,
  toolFailureDefinitionSha256,
  toolFailureSemantics,
  toolFailureSignal,
  type ToolFailureDeclaration,
} from "./tool-failure-semantics.js";

const MODES = [
  mode("invalid_input", "invalid_input", "invocation", "correct_input"),
  mode("target_not_found", "not_found", "target", "terminal"),
  mode("response_invalid", "unknown", "target", "terminal"),
  mode("route_unauthorized", "unauthorized", "route", "alternate_route"),
  mode("route_forbidden", "forbidden", "route", "alternate_route"),
  mode("route_rate_limited", "rate_limited", "route", "retry_after"),
  mode("origin_timeout", "timeout", "origin", "alternate_route"),
  mode("origin_network", "network", "origin", "alternate_route"),
  mode("capability_unavailable", "unavailable", "capability", "terminal"),
  mode("session_inactive", "session_state", "session", "recover_state", true),
  mode("resource_limit", "resource_limit", "invocation", "terminal"),
  mode("policy_denied", "policy", "invocation", "terminal"),
  mode("cancelled", "cancelled", "invocation", "terminal"),
  mode("unknown", "unknown", "invocation", "terminal"),
] as const;

export const WEB_FETCH_FAILURE_DECLARATION: ToolFailureDeclaration = {
  schemaVersion: 1,
  classificationVersion: "1.0.0",
  modes: MODES,
  resolve(input, failure) {
    const signal = toolFailureSignal(failure);
    const transport = structuredTransportFailureClass(failure);
    const modeId =
      signal?.modeId ??
      (transport === "cancelled"
        ? "cancelled"
        : transport === "timeout"
          ? "origin_timeout"
          : transport === "network"
            ? "origin_network"
            : undefined);
    if (!modeId) throw new Error("Web Fetch failure has no typed signal");
    const selected = declaredFailureMode(WEB_FETCH_FAILURE_DECLARATION, modeId);
    return {
      semantics: toolFailureSemantics(selected),
      ...(selected.scope === "invocation"
        ? {}
        : {
            bindingKey:
              signal?.bindingKey ?? defaultBinding(selected.scope, input),
          }),
      ...(signal?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: signal.retryAfterMs }),
    };
  },
};

export const WEB_FETCH_FAILURE_DEFINITION_SHA256 = toolFailureDefinitionSha256(
  toolFailureDefinitionForDeclaration(WEB_FETCH_FAILURE_DECLARATION),
);

export type WebFetchFailureModeId = (typeof MODES)[number]["modeId"];

export function webFetchFailure(
  message: string,
  modeId: WebFetchFailureModeId,
  bindingKey?: unknown,
  options?: ErrorOptions & { retryAfterMs?: number },
): ToolFailureError {
  return new ToolFailureError(
    message,
    {
      modeId,
      ...(bindingKey === undefined ? {} : { bindingKey }),
      ...(options?.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.retryAfterMs }),
    },
    options,
  );
}

export function webFetchCancelled(cause: unknown): ToolFailureError {
  return webFetchFailure("Web fetch was cancelled", "cancelled", undefined, {
    cause,
  });
}

export function webFetchFailureReceipt(input: unknown, failure: unknown) {
  return resolveDeclaredToolFailure(
    WEB_FETCH_FAILURE_DECLARATION,
    input,
    failure,
  );
}

export function webFetchTargetBinding(url: string): unknown {
  return { kind: "public-url", url: normalizeUrl(url) };
}

export function webFetchOriginBinding(url: string): unknown {
  return { kind: "public-origin", origin: origin(url) };
}

export function webFetchRouteBinding(
  url: string,
  route: "static_http" | "browser_render",
): unknown {
  return { kind: "web-fetch-route", route, origin: origin(url) };
}

export function webFetchCapabilityBinding(
  capability: "public_document_acquisition" | "browser_render",
): unknown {
  return { kind: "web-fetch-capability", capability };
}

export function webFetchSessionBinding(): unknown {
  return { kind: "browser-session", lane: "web_fetch_fallback" };
}

function defaultBinding(scope: ToolFailureModeV1["scope"], input: unknown) {
  const value = record(input);
  const url = text(value["url"]);
  const route =
    text(value["attemptedRoute"]) === "browser_render"
      ? "browser_render"
      : "static_http";
  if (scope === "target") {
    return url
      ? webFetchTargetBinding(url)
      : {
          kind: "web-fetch-source",
          sourceId: text(value["sourceId"]),
          sourceContentSha256: text(value["sourceContentSha256"]),
        };
  }
  if (scope === "origin") return webFetchOriginBinding(url);
  if (scope === "route") return webFetchRouteBinding(url, route);
  if (scope === "capability") {
    return webFetchCapabilityBinding(
      route === "browser_render"
        ? "browser_render"
        : "public_document_acquisition",
    );
  }
  return webFetchSessionBinding();
}

function normalizeUrl(value: string): string {
  return value.trim();
}

function origin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "invalid";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mode(
  modeId: string,
  failureClass: ToolFailureModeV1["class"],
  scope: ToolFailureModeV1["scope"],
  disposition: ToolFailureModeV1["disposition"],
  fatalToSession = false,
): ToolFailureModeV1 {
  return { modeId, class: failureClass, scope, disposition, fatalToSession };
}
