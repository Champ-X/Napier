import { createHash } from "node:crypto";

import {
  NAPIER_API_VERSION,
  type DiscoverReceiptTrustAnchorDirectoryRequest,
  type ReceiptTrustAnchorDirectoryDiscovery,
} from "@napier/contracts";
import {
  canonicalJson,
} from "@napier/runtime/core";
import {
  validateMcpEndpoint,
} from "@napier/runtime/tools";
import {
  validateReceiptTrustAnchorDirectory,
  verifyReceiptTrustAnchorDirectory,
} from "@napier/runtime/governance";

export const MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const RECEIPT_TRUST_DIRECTORY_DISCOVERY_TIMEOUT_MS = 8_000;

export type ReceiptTrustAnchorDirectoryFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export interface ReceiptTrustAnchorDirectoryDiscoveryOptions {
  allowedOrigins?: string[];
  fetcher?: ReceiptTrustAnchorDirectoryFetcher;
  validateEndpoint?: (sourceUrl: string) => Promise<void>;
}

export interface ReceiptTrustAnchorDirectoryHostedJsonSource {
  sourceUrl: string;
  sourceOrigin: string;
  sourceUrlSha256: string;
  sourceOriginSha256: string;
  httpStatus: number;
  responseMediaType: string;
  responseBytes: number;
  responseBodySha256: string;
  value: unknown;
}

export class ReceiptTrustAnchorDirectoryDiscoveryError extends Error {
  readonly status: 400 | 403 | 502 | 504;

  constructor(message: string, status: 400 | 403 | 502 | 504) {
    super(message);
    this.name = "ReceiptTrustAnchorDirectoryDiscoveryError";
    this.status = status;
  }
}

export class ReceiptTrustAnchorDirectoryDiscoveryService {
  private readonly allowedOrigins: Set<string>;
  private readonly fetcher: ReceiptTrustAnchorDirectoryFetcher;
  private readonly validateEndpoint: (sourceUrl: string) => Promise<void>;

  constructor(options: ReceiptTrustAnchorDirectoryDiscoveryOptions = {}) {
    this.allowedOrigins = new Set(
      normalizeReceiptTrustAnchorDirectoryOrigins(
        options.allowedOrigins ?? receiptTrustAnchorDirectoryOriginsFromEnv(),
      ),
    );
    this.fetcher =
      options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.validateEndpoint = options.validateEndpoint ?? validateMcpEndpoint;
  }

  async discover(
    request: DiscoverReceiptTrustAnchorDirectoryRequest,
  ): Promise<ReceiptTrustAnchorDirectoryDiscovery> {
    const source = await this.fetchJson(request.sourceUrl);
    const verification = verifyReceiptTrustAnchorDirectory(
      source.value,
      request.policy,
    );
    const directory =
      verification.status === "valid"
        ? validateReceiptTrustAnchorDirectory(source.value)
        : undefined;
    const generatedAt = new Date().toISOString();
    const content = {
      kind: "napier.receipt-trust-anchor-directory-discovery" as const,
      schemaVersion: 1 as const,
      apiVersion: NAPIER_API_VERSION,
      generatedAt,
      status: verification.status,
      sourceUrlSha256: source.sourceUrlSha256,
      sourceOriginSha256: source.sourceOriginSha256,
      httpStatus: source.httpStatus,
      responseMediaType: source.responseMediaType,
      responseBytes: source.responseBytes,
      responseBodySha256: source.responseBodySha256,
      verification,
      ...(directory ? { directory } : {}),
    };
    return {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
  }

  async fetchJson(
    sourceUrlInput: string,
  ): Promise<ReceiptTrustAnchorDirectoryHostedJsonSource> {
    const sourceUrl =
      normalizeReceiptTrustAnchorDirectorySourceUrl(sourceUrlInput);
    if (!this.allowedOrigins.has(sourceUrl.origin)) {
      throw new ReceiptTrustAnchorDirectoryDiscoveryError(
        "Receipt trust anchor directory source origin is not allowed",
        403,
      );
    }
    try {
      await this.validateEndpoint(sourceUrl.href);
    } catch {
      throw new ReceiptTrustAnchorDirectoryDiscoveryError(
        "Receipt trust anchor directory source is not a public HTTPS endpoint",
        400,
      );
    }

    const response = await fetchReceiptTrustAnchorDirectory(
      this.fetcher,
      sourceUrl.href,
    );
    const responseMediaType = requireJsonResponseMediaType(response);
    const responseBody = await readBoundedResponseBody(response);
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(responseBody),
      ) as unknown;
    } catch {
      throw new ReceiptTrustAnchorDirectoryDiscoveryError(
        "Receipt trust anchor directory source did not return valid UTF-8 JSON",
        502,
      );
    }
    return {
      sourceUrl: sourceUrl.href,
      sourceOrigin: sourceUrl.origin,
      sourceUrlSha256: sha256(sourceUrl.href),
      sourceOriginSha256: sha256(sourceUrl.origin),
      httpStatus: response.status,
      responseMediaType,
      responseBytes: responseBody.byteLength,
      responseBodySha256: sha256(responseBody),
      value: input,
    };
  }
}

export function receiptTrustAnchorDirectoryOriginsFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured =
    environment["NAPIER_RECEIPT_TRUST_DIRECTORY_ORIGINS"] ?? "";
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function normalizeReceiptTrustAnchorDirectoryOrigins(
  origins: string[],
): string[] {
  return Array.from(
    new Set(
      origins.map((origin) => {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          throw new Error(
            "Receipt trust anchor directory allowed origin is invalid",
          );
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        ) {
          throw new Error(
            "Receipt trust anchor directory allowed origin is invalid",
          );
        }
        return url.origin;
      }),
    ),
  ).sort();
}

function normalizeReceiptTrustAnchorDirectorySourceUrl(value: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source URL is invalid",
      400,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source URL is invalid",
      400,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source URL is invalid",
      400,
    );
  }
  return url;
}

async function fetchReceiptTrustAnchorDirectory(
  fetcher: ReceiptTrustAnchorDirectoryFetcher,
  sourceUrl: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(RECEIPT_TRUST_DIRECTORY_DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      error instanceof DOMException && error.name === "TimeoutError"
        ? "Receipt trust anchor directory discovery timed out"
        : "Receipt trust anchor directory source is unavailable",
      error instanceof DOMException && error.name === "TimeoutError"
        ? 504
        : 502,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source redirects are not allowed",
      502,
    );
  }
  if (response.status !== 200) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source returned an unsuccessful response",
      502,
    );
  }
  return response;
}

function requireJsonResponseMediaType(response: Response): string {
  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (
    mediaType !== "application/json" &&
    !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType)
  ) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source did not return JSON",
      502,
    );
  }
  return mediaType;
}

async function readBoundedResponseBody(
  response: Response,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES
    ) {
      throw new ReceiptTrustAnchorDirectoryDiscoveryError(
        "Receipt trust anchor directory response exceeds the size limit",
        502,
      );
    }
  }
  if (!response.body) {
    throw new ReceiptTrustAnchorDirectoryDiscoveryError(
      "Receipt trust anchor directory source returned an empty response",
      502,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_RECEIPT_TRUST_DIRECTORY_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ReceiptTrustAnchorDirectoryDiscoveryError(
        "Receipt trust anchor directory response exceeds the size limit",
        502,
      );
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
