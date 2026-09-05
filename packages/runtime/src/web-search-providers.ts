import { sha256 } from "./ed25519.js";
import { PublicHttpClient } from "./public-http-client.js";
import type {
  ToolOperationLifecycle,
  ToolOperationObserver,
} from "./tool-operation-journal.js";
import { createDefaultWebSearchProviders } from "./web-search-provider-implementations.js";
import { negotiateWebSearchCapabilityRoute } from "./web-search-capability-routing.js";
import type {
  WebSearchProvider,
  WebSearchProviderRegistryOptions,
} from "./web-search-provider-types.js";
import {
  type NormalizedWebSearchRequest,
  type WebSearchProviderAttempt,
  type WebSearchResponse,
  type WebSearchResult,
  webSearchResultSetSha256,
} from "./web-search-model.js";
import {
  providerDiagnostic,
  sanitizeWebSearchResults,
  throwIfSearchAborted,
} from "./web-search-provider-utils.js";
import {
  WEB_SEARCH_FAILURE_DEFINITION_SHA256,
  webSearchCapabilityBinding,
  webSearchFailure,
  webSearchFailureReceipt,
  webSearchRouteBinding,
} from "./web-search-failure.js";

export type {
  PublicHttpRequester,
  WebSearchProvider,
  WebSearchProviderRegistryOptions,
} from "./web-search-provider-types.js";

export class WebSearchProviderRegistry {
  private readonly providers: readonly WebSearchProvider[];
  private readonly now: () => Date;

  constructor(options: WebSearchProviderRegistryOptions = {}) {
    const env = options.env ?? process.env;
    const http = options.http ?? new PublicHttpClient();
    this.providers =
      options.providers ?? createDefaultWebSearchProviders(http, env);
    this.now = options.now ?? (() => new Date());
  }

  async search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
    operations?: ToolOperationObserver,
  ): Promise<WebSearchResponse> {
    const route = negotiateWebSearchCapabilityRoute(this.providers, request);
    const candidates = route.selectedProviders;
    if (candidates.length === 0) {
      throw webSearchFailure(
        `Web search provider is not installed: ${request.provider}`,
        "capability_unavailable",
        webSearchCapabilityBinding(request),
      );
    }
    const supportedCandidates = route.candidates;
    if (supportedCandidates.length === 0) {
      await this.rejectUnsupportedCandidates(candidates, request, operations);
      throw webSearchFailure(
        `Web search provider does not support ${request.category} results: ${request.provider}`,
        "capability_unsupported",
        webSearchCapabilityBinding(request),
      );
    }
    if (
      route.resolvedCategory === "images" &&
      !supportedCandidates.some((provider) => provider.available())
    ) {
      await this.rejectUnavailableCandidates(
        candidates,
        supportedCandidates,
        request,
        operations,
      );
      throw webSearchFailure(
        "Web image search is unavailable because no configured provider can return image results. Configure BRAVE_API_KEY or use category general to find an image-bearing public page or API.",
        "capability_unavailable",
        webSearchCapabilityBinding(request),
      );
    }
    const attempts: WebSearchProviderAttempt[] = [];
    for (const provider of supportedCandidates) {
      throwIfSearchAborted(signal);
      const operation = operations?.operation(
        operationDescriptor(candidates, provider, route.request, {
          requestedCategory: route.requestedCategory,
          resolutionMode: route.resolutionMode,
        }),
      );
      await operation?.proposed();
      if (!provider.available()) {
        await recordUnavailableAttempt(operation, provider, request, attempts);
        continue;
      }
      const admission = await operation?.admit();
      if (admission && !admission.admitted) {
        attempts.push({
          provider: provider.id,
          status: "failed",
          diagnostic: admission.reason ?? "failure circuit is open",
        });
        continue;
      }
      await operation?.started();
      const results = await searchProvider(
        provider,
        route.request,
        signal,
        operation,
        attempts,
      );
      if (!results) {
        if (request.provider !== "auto") break;
        continue;
      }
      const resultSetSha256 = webSearchResultSetSha256(results);
      await operation?.settled({
        outcome: "succeeded",
        state: resultSetSha256,
        effect: { resultCount: results.length, resultSetSha256 },
      });
      attempts.push({ provider: provider.id, status: "succeeded" });
      return {
        provider: provider.id,
        results,
        attempts,
        retrievedAt: this.now().toISOString(),
        ...(route.resolutionMode === "image_page_candidates"
          ? {
              resolution: {
                requestedCategory: route.requestedCategory,
                resolvedCategory: route.resolvedCategory,
                mode: route.resolutionMode,
              },
            }
          : {}),
      };
    }
    const summary = attempts
      .map(
        (attempt) =>
          `${attempt.provider}: ${attempt.diagnostic ?? attempt.status}`,
      )
      .join("; ");
    const unavailable = attempts.every(
      (attempt) => attempt.status === "unavailable",
    );
    throw webSearchFailure(
      `Web search failed after ${attempts.length} provider attempt${attempts.length === 1 ? "" : "s"}${summary ? ` (${summary})` : ""}`,
      unavailable ? "capability_unavailable" : "unknown",
      unavailable ? webSearchCapabilityBinding(request) : undefined,
    );
  }

  private async rejectUnsupportedCandidates(
    candidates: readonly WebSearchProvider[],
    request: NormalizedWebSearchRequest,
    operations: ToolOperationObserver | undefined,
  ): Promise<void> {
    for (const provider of candidates) {
      const operation = operations?.operation(
        operationDescriptor(candidates, provider, request),
      );
      const diagnostic = `${provider.id} does not support ${request.category} results`;
      const error = webSearchFailure(
        diagnostic,
        "capability_unsupported",
        webSearchCapabilityBinding({ ...request, provider: provider.id }),
      );
      await rejectOperation(
        operation,
        "unsupported",
        diagnostic,
        error,
        request,
        provider.id,
      );
    }
  }

  private async rejectUnavailableCandidates(
    candidates: readonly WebSearchProvider[],
    supportedCandidates: readonly WebSearchProvider[],
    request: NormalizedWebSearchRequest,
    operations: ToolOperationObserver | undefined,
  ): Promise<void> {
    for (const provider of supportedCandidates) {
      if (provider.available()) continue;
      const operation = operations?.operation(
        operationDescriptor(candidates, provider, request),
      );
      const diagnostic = `${provider.id} credentials are not configured`;
      const error = webSearchFailure(
        diagnostic,
        "capability_unavailable",
        webSearchCapabilityBinding({ ...request, provider: provider.id }),
      );
      await rejectOperation(
        operation,
        "unavailable",
        diagnostic,
        error,
        request,
        provider.id,
      );
    }
  }
}

async function recordUnavailableAttempt(
  operation: ToolOperationLifecycle | undefined,
  provider: WebSearchProvider,
  request: NormalizedWebSearchRequest,
  attempts: WebSearchProviderAttempt[],
): Promise<void> {
  const diagnostic = `${provider.id} credentials are not configured`;
  const error = webSearchFailure(
    diagnostic,
    "capability_unavailable",
    webSearchCapabilityBinding({ ...request, provider: provider.id }),
  );
  const failure = webSearchFailureReceipt(
    { ...request, attemptedProvider: provider.id },
    error,
  );
  const admission = await operation?.admit({
    admitted: false,
    diagnostic,
    failure,
  });
  if (!admission || admission.source === "caller") {
    await operation?.settled({
      outcome: "skipped",
      diagnostic,
      failure,
      effect: { admission: "rejected", reason: "unavailable" },
    });
  }
  attempts.push({
    provider: provider.id,
    status: admission?.source === "failure_circuit" ? "failed" : "unavailable",
    diagnostic: admission?.reason ?? diagnostic,
  });
}

async function searchProvider(
  provider: WebSearchProvider,
  request: NormalizedWebSearchRequest,
  signal: AbortSignal,
  operation: ToolOperationLifecycle | undefined,
  attempts: WebSearchProviderAttempt[],
): Promise<WebSearchResult[] | undefined> {
  try {
    const results = sanitizeWebSearchResults(
      await provider.search(request, signal),
      request.count,
      request.site,
    );
    if (results.length === 0) {
      throw webSearchFailure(
        "provider returned no usable public results",
        "target_not_found",
        {
          kind: "web-search-target",
          query: request.query,
          category: request.category,
          site: request.site ?? "",
        },
      );
    }
    return results;
  } catch (error) {
    const failure = webSearchFailureReceipt(
      { ...request, attemptedProvider: provider.id },
      error,
    );
    await operation?.settled({
      outcome: "failed",
      diagnostic: error,
      failure,
      effect: {
        outcome: "failed",
        diagnosticSha256: operationDiagnosticSha256(error),
      },
    });
    throwIfSearchAborted(signal);
    attempts.push({
      provider: provider.id,
      status: "failed",
      diagnostic: providerDiagnostic(error),
    });
    return undefined;
  }
}

function operationDescriptor(
  candidates: readonly WebSearchProvider[],
  provider: WebSearchProvider,
  request: NormalizedWebSearchRequest,
  resolution: {
    requestedCategory: NormalizedWebSearchRequest["category"];
    resolutionMode: "direct" | "image_page_candidates";
  } = {
    requestedCategory: request.category,
    resolutionMode: "direct",
  },
) {
  const routeBinding = webSearchRouteBinding(provider.id);
  return {
    ordinal: candidates.indexOf(provider) + 1,
    mode: request.provider === "auto" ? "fallback" : "direct",
    route: provider.id,
    operation: "acquire" as const,
    scope: "external" as const,
    contribution: "supporting" as const,
    resourceKey: {
      kind: "query",
      query: request.query,
      category: request.category,
      requestedCategory: resolution.requestedCategory,
      resolutionMode: resolution.resolutionMode,
      timeRange: request.timeRange ?? "",
      language: request.language,
      region: request.region,
      site: request.site ?? "",
      count: request.count,
      safeSearch: request.safeSearch,
    },
    failureBindings: {
      target: {
        kind: "web-search-target",
        query: request.query,
        category: request.category,
        site: request.site ?? "",
      },
      route: routeBinding,
      capability: webSearchCapabilityBinding({
        ...request,
        provider: provider.id,
      }),
    },
    failureDefinitionSha256: WEB_SEARCH_FAILURE_DEFINITION_SHA256,
    failureDomainKey: routeBinding,
  };
}

async function rejectOperation(
  operation: ToolOperationLifecycle | undefined,
  reason: "unavailable" | "unsupported",
  diagnostic: string,
  error: unknown,
  request: NormalizedWebSearchRequest,
  provider: string,
): Promise<void> {
  const failure = webSearchFailureReceipt(
    { ...request, attemptedProvider: provider },
    error,
  );
  await operation?.proposed();
  const admission = await operation?.admit({
    admitted: false,
    diagnostic,
    failure,
  });
  if (!admission || admission.source === "caller") {
    await operation?.settled({
      outcome: "skipped",
      diagnostic,
      failure,
      effect: { admission: "rejected", reason },
    });
  }
}

function operationDiagnosticSha256(error: unknown): string {
  return sha256(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
}
