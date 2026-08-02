import { createHash } from "node:crypto";

import type { JsonValue } from "@napier/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ContentSha256Mode = "body" | "stable";

export function sha256Json(value: JsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function setContentSha256Header(
  context: Context,
  digest: string,
  mode: ContentSha256Mode,
): void {
  context.header("X-Napier-Content-SHA256", digest);
  context.header("X-Napier-Content-SHA256-Mode", mode);
}

export function setBodyContentSha256Header(
  context: Context,
  body: unknown,
): void {
  setContentSha256Header(context, sha256Text(JSON.stringify(body)), "body");
}

export function setStableContentSha256Header(
  context: Context,
  digest: string,
): void {
  setContentSha256Header(context, digest, "stable");
}

export function jsonError(
  context: Context,
  message: string,
  status: ContentfulStatusCode,
): Response {
  const body = { error: message };
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, body);
  context.header("X-Napier-Error-Status", String(status));
  context.header("X-Napier-Error-Code", jsonErrorCode(status));
  context.header("X-Napier-Error-Message-SHA256", sha256Text(body.error));
  return context.json(body, status);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonErrorCode(status: ContentfulStatusCode): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server_error" : "http_error";
  }
}
