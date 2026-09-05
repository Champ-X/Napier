import type { ToolFailureModeV1 } from "@napier/contracts/tool-protocol";

import {
  declaredFailureMode,
  resolveDeclaredToolFailure,
  structuredTransportFailureClass,
  ToolFailureError,
  toolFailureSemantics,
  toolFailureDefinitionForDeclaration,
  toolFailureDefinitionSha256,
  toolFailureSignal,
  type ToolFailureDeclaration,
} from "./tool-failure-semantics.js";
import type { NormalizedWebSearchRequest } from "./web-search-model.js";

const MODES = [
  mode("invalid_input", "invalid_input", "invocation", "correct_input"),
  mode("capability_unavailable", "unavailable", "capability", "terminal"),
  mode("capability_unsupported", "unsupported", "capability", "terminal"),
  mode("route_unauthorized", "unauthorized", "route", "alternate_route"),
  mode("route_forbidden", "forbidden", "route", "alternate_route"),
  mode("route_rate_limited", "rate_limited", "route", "retry_after"),
  mode("route_timeout", "timeout", "route", "alternate_route"),
  mode("route_network", "network", "route", "alternate_route"),
  mode("target_not_found", "not_found", "target", "terminal"),
  mode("cancelled", "cancelled", "invocation", "terminal"),
  mode("unknown", "unknown", "invocation", "terminal"),
] as const;

export const WEB_SEARCH_FAILURE_DECLARATION: ToolFailureDeclaration = {
  schemaVersion: 1,
  classificationVersion: "1.0.0",
  modes: MODES,
  resolve(input, failure) {
    const request = requestRecord(input);
    const signal = toolFailureSignal(failure);
    const structuredClass = structuredTransportFailureClass(failure);
    const modeId =
      signal?.modeId ??
      (structuredClass === "cancelled"
        ? "cancelled"
        : structuredClass === "timeout"
          ? "route_timeout"
          : structuredClass === "network"
            ? "route_network"
            : undefined);
    if (!modeId) throw new Error("Web Search failure has no typed signal");
    const selected = declaredFailureMode(
      WEB_SEARCH_FAILURE_DECLARATION,
      modeId,
    );
    return {
      semantics: toolFailureSemantics(selected),
      ...(selected.scope === "invocation"
        ? {}
        : {
            bindingKey:
              signal?.bindingKey ?? defaultBinding(selected.scope, request),
          }),
      ...(signal?.retryAfterMs !== undefined
        ? { retryAfterMs: signal.retryAfterMs }
        : {}),
    };
  },
};

export const WEB_SEARCH_FAILURE_DEFINITION_SHA256 = toolFailureDefinitionSha256(
  toolFailureDefinitionForDeclaration(WEB_SEARCH_FAILURE_DECLARATION),
);

export function webSearchFailure(
  message: string,
  modeId: (typeof MODES)[number]["modeId"],
  bindingKey?: unknown,
  options?: ErrorOptions & { retryAfterMs?: number },
): ToolFailureError {
  return new ToolFailureError(
    message,
    {
      modeId,
      ...(bindingKey !== undefined ? { bindingKey } : {}),
      ...(options?.retryAfterMs !== undefined
        ? { retryAfterMs: options.retryAfterMs }
        : {}),
    },
    options,
  );
}

export function webSearchFailureReceipt(
  request: NormalizedWebSearchRequest & { attemptedProvider?: string },
  failure: unknown,
) {
  return resolveDeclaredToolFailure(
    WEB_SEARCH_FAILURE_DECLARATION,
    request,
    failure,
  );
}

export function webSearchRouteBinding(provider: string): unknown {
  return { kind: "web-search-provider", provider };
}

export function webSearchCapabilityBinding(
  request: Pick<NormalizedWebSearchRequest, "category" | "provider">,
): unknown {
  return {
    kind: "web-search-capability",
    category: request.category,
    provider: request.provider,
  };
}

function defaultBinding(
  scope: ToolFailureModeV1["scope"],
  input: Record<string, unknown>,
): unknown {
  if (scope === "route") {
    return webSearchRouteBinding(
      text(input["attemptedProvider"]) || text(input["provider"]) || "auto",
    );
  }
  if (scope === "capability") {
    return {
      kind: "web-search-capability",
      category: text(input["category"]) || "general",
      provider: text(input["provider"]) || "auto",
    };
  }
  return {
    kind: "web-search-target",
    query: text(input["query"]),
    category: text(input["category"]) || "general",
    site: text(input["site"]),
  };
}

function requestRecord(value: unknown): Record<string, unknown> {
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
): ToolFailureModeV1 {
  return {
    modeId,
    class: failureClass,
    scope,
    disposition,
    fatalToSession: false,
  };
}
