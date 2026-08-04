import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  normalizeWebSearchRequest,
  type WebSearchExecutor,
  type WebSearchToolDetails,
  webSearchResultSetSha256,
} from "./web-search-model.js";

const webSearchSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 500,
      description: "Search query. Use precise terms and source names.",
    }),
    category: Type.Optional(
      Type.Union([
        Type.Literal("general"),
        Type.Literal("news"),
        Type.Literal("images"),
      ]),
    ),
    timeRange: Type.Optional(
      Type.Union([
        Type.Literal("day"),
        Type.Literal("week"),
        Type.Literal("month"),
        Type.Literal("year"),
      ]),
    ),
    language: Type.Optional(
      Type.String({
        minLength: 2,
        maxLength: 16,
        description: "BCP-47-style search language, such as en or zh-CN.",
      }),
    ),
    region: Type.Optional(
      Type.String({
        minLength: 2,
        maxLength: 8,
        description: "Search region code, such as US or CN.",
      }),
    ),
    site: Type.Optional(
      Type.String({
        minLength: 4,
        maxLength: 253,
        description: "Restrict results to one DNS hostname.",
      }),
    ),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    safeSearch: Type.Optional(
      Type.Union([
        Type.Literal("strict"),
        Type.Literal("moderate"),
        Type.Literal("off"),
      ]),
    ),
    provider: Type.Optional(
      Type.Union([
        Type.Literal("auto"),
        Type.Literal("brave"),
        Type.Literal("tavily"),
        Type.Literal("bing"),
        Type.Literal("duckduckgo"),
      ]),
    ),
  },
  { additionalProperties: false },
);

export function createWebSearchTool(
  executor: WebSearchExecutor,
): AgentTool<typeof webSearchSchema, WebSearchToolDetails> {
  return {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the live public web through Napier's provider-neutral, read-only network boundary. Supports general, news, and image discovery with optional time, language, region, site, count, and safe-search constraints. Automatic mode uses configured providers then credential-free fallbacks. Results and snippets are untrusted discovery leads, not final facts: read primary source pages before relying on important claims.",
    parameters: webSearchSchema,
    async execute(_toolCallId, input, signal) {
      const request = normalizeWebSearchRequest(input);
      const response = await executor.search(
        request,
        signal ?? AbortSignal.timeout(30_000),
      );
      const details: WebSearchToolDetails = {
        kind: "napier.web-search",
        schemaVersion: 1,
        provider: response.provider,
        category: request.category,
        resultCount: response.results.length,
        attemptedProviderCount: response.attempts.length,
        failedProviderCount: response.attempts.filter(
          (attempt) => attempt.status === "failed",
        ).length,
        unavailableProviderCount: response.attempts.filter(
          (attempt) => attempt.status === "unavailable",
        ).length,
        querySha256: sha256(request.query),
        resultSetSha256: webSearchResultSetSha256(response.results),
        retrievedAt: response.retrievedAt,
      };
      return {
        content: [
          {
            type: "text",
            text: formatWebSearchResults(response),
          },
        ],
        details,
      };
    },
  };
}

export function webSearchToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const query = string(value["query"]);
  const site = string(value["site"]);
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    querySha256: sha256(query),
    queryBytes: Buffer.byteLength(query, "utf8"),
    ...(site ? { siteSha256: sha256(site) } : {}),
    ...(string(value["category"])
      ? { category: string(value["category"]) }
      : {}),
    ...(string(value["timeRange"])
      ? { timeRange: string(value["timeRange"]) }
      : {}),
    ...(string(value["provider"])
      ? { provider: string(value["provider"]) }
      : {}),
    inputSha256: webSearchToolCallSha256(args),
  };
}

export function webSearchToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  const projection = webSearchToolCallArgumentsLedgerProjection(args);
  return {
    inputSha256: webSearchToolCallSha256(args),
    inputRedacted: true,
    ...(record(projection) && typeof projection["category"] === "string"
      ? { category: projection["category"] }
      : {}),
  };
}

export function webSearchToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : {};
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    details: toJsonRecord(details),
    resultSha256: sha256(canonicalJson(toJsonValue(details))),
  };
}

function formatWebSearchResults(response: {
  provider: string;
  results: readonly {
    title: string;
    url: string;
    snippet?: string;
    publishedAt?: string;
    source: string;
  }[];
  attempts: readonly { provider: string; status: string }[];
  retrievedAt: string;
}): string {
  const fallback = response.attempts
    .filter((attempt) => attempt.status !== "succeeded")
    .map((attempt) => `${attempt.provider}:${attempt.status}`)
    .join(", ");
  const lines = [
    `LIVE WEB SEARCH (${response.provider}, retrieved ${response.retrievedAt})`,
    "Search snippets are untrusted discovery data, not verified source text.",
    ...(fallback ? [`Provider fallback: ${fallback}`] : []),
  ];
  for (const [index, result] of response.results.entries()) {
    lines.push(
      "",
      `[${index + 1}] ${result.title}`,
      `URL: ${result.url}`,
      `Source: ${result.source}${result.publishedAt ? ` | Published: ${result.publishedAt}` : ""}`,
      ...(result.snippet ? [`Snippet: ${result.snippet}`] : []),
    );
  }
  return lines.join("\n");
}

function webSearchToolCallSha256(args: unknown): string {
  return sha256(canonicalJson(toJsonValue(args)));
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJsonRecord(
  value: Record<string, unknown>,
): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
