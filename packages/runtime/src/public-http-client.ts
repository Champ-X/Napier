import {
  request as createHttpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { request as createHttpsRequest } from "node:https";
import type { LookupFunction } from "node:net";

import {
  type PublicHostLookup,
  type PublicHostResolution,
  resolvePublicHost,
  validatePublicHttpUrl,
} from "./public-network.js";

export const PUBLIC_HTTP_TIMEOUT_MS = 12_000;
export const PUBLIC_HTTP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const PUBLIC_HTTP_MAX_REDIRECTS = 4;

export interface PublicHttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

export interface PublicHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  finalUrl: string;
  redirectCount: number;
}

export interface PublicHttpClientOptions {
  lookup?: PublicHostLookup;
  transport?: PublicHttpTransport;
}

export interface PublicHttpTransportRequest {
  url: URL;
  resolution: PublicHostResolution;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
  maxResponseBytes: number;
  signal: AbortSignal;
}

export type PublicHttpTransport = (
  request: PublicHttpTransportRequest,
) => Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}>;

export class PublicHttpClient {
  constructor(private readonly options: PublicHttpClientOptions = {}) {}

  async request(
    request: PublicHttpRequest,
    signal?: AbortSignal,
  ): Promise<PublicHttpResponse> {
    const timeoutMs = boundedPositiveInteger(
      request.timeoutMs,
      PUBLIC_HTTP_TIMEOUT_MS,
      1_000,
      30_000,
      "Public HTTP timeout",
    );
    const maxResponseBytes = boundedPositiveInteger(
      request.maxResponseBytes,
      PUBLIC_HTTP_MAX_RESPONSE_BYTES,
      1,
      8 * 1024 * 1024,
      "Public HTTP response limit",
    );
    const maxRedirects = boundedPositiveInteger(
      request.maxRedirects,
      PUBLIC_HTTP_MAX_REDIRECTS,
      0,
      8,
      "Public HTTP redirect limit",
    );
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    return this.requestValidated(
      {
        ...request,
        method: request.method ?? "GET",
        maxResponseBytes,
        maxRedirects,
      },
      0,
      combinedSignal,
    );
  }

  private async requestValidated(
    request: PublicHttpRequest & {
      method: "GET" | "POST";
      maxResponseBytes: number;
      maxRedirects: number;
    },
    redirectCount: number,
    signal: AbortSignal,
  ): Promise<PublicHttpResponse> {
    throwIfAborted(signal);
    const url = validatePublicHttpUrl(request.url);
    const resolution = await resolvePublicHost(url.hostname, {
      ...(this.options.lookup ? { lookup: this.options.lookup } : {}),
    });
    throwIfAborted(signal);
    const headers = sanitizeHeaders(request.headers);
    const body = redirectCount === 0 ? request.body : undefined;
    if (body !== undefined) {
      headers["content-length"] = String(Buffer.byteLength(body, "utf8"));
    }
    const method = redirectCount === 0 ? request.method : "GET";
    const response = await (this.options.transport ?? nodeHttpTransport)({
      url,
      resolution,
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      maxResponseBytes: request.maxResponseBytes,
      signal,
    });
    assertResponseBound(response, request.maxResponseBytes);
    if (!redirectStatus(response.status)) {
      return {
        ...response,
        finalUrl: url.href,
        redirectCount,
      };
    }
    const location = firstHeader(response.headers.location);
    if (!location) {
      throw new Error("Public HTTP redirect is missing a Location header");
    }
    if (redirectCount >= request.maxRedirects) {
      throw new Error("Public HTTP redirect limit exceeded");
    }
    const redirected = new URL(location, url);
    const { body: _body, ...redirectRequest } = request;
    const redirectedHeaders = stripSensitiveHeaders(request.headers);
    return this.requestValidated(
      {
        ...redirectRequest,
        url: redirected.href,
        method: "GET",
        ...(redirectedHeaders ? { headers: redirectedHeaders } : {}),
      },
      redirectCount + 1,
      signal,
    );
  }
}

function assertResponseBound(
  response: { headers: IncomingHttpHeaders; body: Buffer },
  maxResponseBytes: number,
): void {
  const declaredLength = Number(
    firstHeader(response.headers["content-length"]),
  );
  if (
    response.body.byteLength > maxResponseBytes ||
    (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes)
  ) {
    throw new Error("Public HTTP response exceeds byte limit");
  }
}

async function nodeHttpTransport(request: PublicHttpTransportRequest): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  const address = request.resolution.addresses[0]!;
  const options: RequestOptions = {
    protocol: request.url.protocol,
    hostname: request.url.hostname,
    port: request.url.port || undefined,
    path: `${request.url.pathname}${request.url.search}`,
    method: request.method,
    headers: request.headers,
    lookup: pinnedLookup(address),
    signal: request.signal,
  };
  return performRequest(
    request.url.protocol === "https:" ? createHttpsRequest : createHttpRequest,
    options,
    request.body,
    request.maxResponseBytes,
  );
}

function performRequest(
  createRequest: typeof createHttpRequest,
  options: RequestOptions,
  body: string | undefined,
  maxResponseBytes: number,
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = createRequest(options);
    outgoing.once("error", reject);
    outgoing.once("response", (response) => {
      response.once("error", reject);
      const declaredLength = Number(
        firstHeader(response.headers["content-length"]),
      );
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > maxResponseBytes
      ) {
        response.destroy(new Error("Public HTTP response exceeds byte limit"));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > maxResponseBytes) {
          response.destroy(
            new Error("Public HTTP response exceeds byte limit"),
          );
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    if (body !== undefined) outgoing.write(body, "utf8");
    outgoing.end();
  });
}

function pinnedLookup(address: {
  address: string;
  family: number;
}): LookupFunction {
  return (_hostname, options, callback) => {
    const family = address.family === 6 ? 6 : 4;
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: address.address, family }]);
      return;
    }
    callback(null, address.address, family);
  };
}

function sanitizeHeaders(
  input: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "*/*",
    "accept-encoding": "identity",
    "user-agent": "Napier/0.1 web-search",
  };
  for (const [rawName, value] of Object.entries(input ?? {})) {
    const name = rawName.toLowerCase();
    if (
      !/^[a-z0-9-]{1,64}$/u.test(name) ||
      /[\r\n]/u.test(value) ||
      ["cookie", "host", "proxy-authorization", "transfer-encoding"].includes(
        name,
      )
    ) {
      throw new Error(`Public HTTP header is not allowed: ${rawName}`);
    }
    headers[name] = value;
  }
  return headers;
}

function stripSensitiveHeaders(
  input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!input) return undefined;
  return Object.fromEntries(
    Object.entries(input).filter(
      ([name]) =>
        !["authorization", "cookie", "x-subscription-token"].includes(
          name.toLowerCase(),
        ),
    ),
  );
}

function redirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Public HTTP request was cancelled");
  }
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return resolved;
}
