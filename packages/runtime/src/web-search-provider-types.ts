import type {
  NormalizedWebSearchRequest,
  WebSearchCategory,
  WebSearchProviderId,
  WebSearchResult,
} from "./web-search-model.js";
import type {
  PublicHttpRequest,
  PublicHttpResponse,
} from "./public-http-client.js";

export interface WebSearchProvider {
  readonly id: WebSearchProviderId;
  /** Declarative route capabilities used before any provider is invoked. */
  readonly capabilities?: readonly WebSearchCategory[];
  /** Legacy compatibility for external providers predating capabilities. */
  readonly supportsImages: boolean;
  available(): boolean;
  search(
    request: NormalizedWebSearchRequest,
    signal: AbortSignal,
  ): Promise<WebSearchResult[]>;
}

export interface PublicHttpRequester {
  request(
    request: PublicHttpRequest,
    signal?: AbortSignal,
  ): Promise<PublicHttpResponse>;
}

export interface WebSearchProviderRegistryOptions {
  env?: Readonly<Record<string, string | undefined>>;
  http?: PublicHttpRequester;
  providers?: readonly WebSearchProvider[];
  now?: () => Date;
}
