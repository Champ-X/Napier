import type {
  NormalizedWebSearchRequest,
  WebSearchCategory,
} from "./web-search-model.js";
import type { WebSearchProvider } from "./web-search-provider-types.js";

export type WebSearchResolutionMode = "direct" | "image_page_candidates";

export interface WebSearchCapabilityRoute {
  selectedProviders: readonly WebSearchProvider[];
  candidates: readonly WebSearchProvider[];
  request: NormalizedWebSearchRequest;
  requestedCategory: WebSearchCategory;
  resolvedCategory: WebSearchCategory;
  resolutionMode: WebSearchResolutionMode;
}

/** Pure capability negotiation; transport execution remains provider-owned. */
export function negotiateWebSearchCapabilityRoute(
  providers: readonly WebSearchProvider[],
  request: NormalizedWebSearchRequest,
): WebSearchCapabilityRoute {
  const selectedProviders =
    request.provider === "auto"
      ? providers
      : providers.filter((provider) => provider.id === request.provider);
  const exact = selectedProviders.filter((provider) =>
    providerSupportsCategory(provider, request.category),
  );
  if (
    request.provider === "auto" &&
    request.category === "images" &&
    !exact.some((provider) => provider.available())
  ) {
    const pageCandidates = selectedProviders.filter((provider) =>
      providerSupportsCategory(provider, "general"),
    );
    if (pageCandidates.some((provider) => provider.available())) {
      return {
        selectedProviders,
        candidates: pageCandidates,
        request: { ...request, category: "general" },
        requestedCategory: "images",
        resolvedCategory: "general",
        resolutionMode: "image_page_candidates",
      };
    }
  }
  return {
    selectedProviders,
    candidates: exact,
    request,
    requestedCategory: request.category,
    resolvedCategory: request.category,
    resolutionMode: "direct",
  };
}

export function providerSupportsCategory(
  provider: WebSearchProvider,
  category: WebSearchCategory,
): boolean {
  return provider.capabilities
    ? provider.capabilities.includes(category)
    : category !== "images" || provider.supportsImages;
}
