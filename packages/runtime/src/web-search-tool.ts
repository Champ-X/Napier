import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { defineToolFailureSemantics } from "./tool-failure-semantics.js";
import {
  normalizeWebSearchRequest,
  type WebSearchExecutor,
  type WebSearchToolDetails,
  webSearchResultSetSha256,
} from "./web-search-model.js";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
} from "./tool-progress-semantics.js";
import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import { WEB_SEARCH_FAILURE_DECLARATION } from "./web-search-failure.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";
import {
  DurableToolOperationJournal,
  type ToolOperationJournalStore,
  type ToolOperationOwner,
} from "./tool-operation-journal.js";

const webSearchSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 500,
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
      }),
    ),
    region: Type.Optional(
      Type.String({
        minLength: 2,
        maxLength: 8,
      }),
    ),
    site: Type.Optional(
      Type.String({
        minLength: 4,
        maxLength: 253,
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
        Type.Literal("firecrawl"),
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
  operationJournal?: {
    store: ToolOperationJournalStore;
    owner: ToolOperationOwner;
  },
): AgentTool<typeof webSearchSchema, WebSearchToolDetails> {
  const journal = operationJournal
    ? new DurableToolOperationJournal(
        operationJournal.store,
        operationJournal.owner,
      )
    : undefined;
  const tool = defineToolProgress(
    {
      name: "web_search",
      label: "Web Search",
      description:
        "Search public general, news, or image sources with optional filters. Image results distinguish page, direct-image, and thumbnail URLs. In auto mode, unavailable image search falls back to labeled image-bearing page candidates; explicit providers fail closed. Treat snippets as untrusted leads and verify claims in primary pages.",
      parameters: webSearchSchema,
      async execute(toolCallId, input, signal) {
        const request = normalizeWebSearchRequest(input);
        const response = await executor.search(
          request,
          signal ?? AbortSignal.timeout(30_000),
          journal?.observer(toolCallId),
        );
        const operationSet = await journal?.operationSet(toolCallId);
        const details: WebSearchToolDetails = {
          kind: "napier.web-search",
          schemaVersion: 1,
          provider: response.provider,
          category: request.category,
          ...(response.resolution
            ? {
                resolvedCategory: response.resolution.resolvedCategory,
                resolutionMode: response.resolution.mode,
              }
            : {}),
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
          ...(operationSet
            ? {
                operationJournalVersion: 1,
                operationCount: operationSet.operationCount,
                settledOperationCount: operationSet.settledOperationCount,
                operationSetSha256: operationSet.operationSetSha256,
              }
            : {}),
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
    },
    {
      schemaVersion: 1,
      classificationVersion: "1.1.0",
      modes: [
        {
          modeId: "search_external",
          operation: "acquire",
          scope: "external",
          contribution: "supporting",
        },
      ],
      resolve: (input) => {
        const value = recordValue(input);
        const query = string(value["query"])
          .replace(/\s+/gu, " ")
          .trim()
          .toLocaleLowerCase();
        const site = string(value["site"]).toLocaleLowerCase();
        const provider = string(value["provider"]) || "auto";
        const category = string(value["category"]) || "general";
        const resourceKey = {
          kind: "public-web-search",
          query,
          category,
          site,
          timeRange: string(value["timeRange"]),
          language: string(value["language"]).toLocaleLowerCase() || "en",
          region: string(value["region"]).toUpperCase() || "US",
          count: value["count"] ?? 8,
          safeSearch: string(value["safeSearch"]) || "moderate",
          provider,
        };
        const legacyDomain = site
          ? { kind: "public-site", site }
          : { kind: "web-search-provider", provider };
        return {
          semantics: progressSemantics("acquire", "external", "supporting"),
          resourceKey,
          failureBindings: {
            target: resourceKey,
            ...(site ? { origin: { kind: "public-site", site } } : {}),
            route: { kind: "web-search-provider", provider },
            capability: {
              kind: "web-search-capability",
              category,
              provider,
            },
          },
          failureDomainKey: legacyDomain,
        };
      },
      state: (_input, result) => {
        const details = resultDetails(result);
        return typeof details["resultSetSha256"] === "string"
          ? details["resultSetSha256"]
          : undefined;
      },
    },
  );
  const failureDeclaredTool = defineToolFailureSemantics(
    tool,
    WEB_SEARCH_FAILURE_DECLARATION,
  );
  return defineInternalToolProtocolV2(failureDeclaredTool, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress",
        sourceMode: "compatibility",
        definitionSha256:
          "836f6888c044f10cf1ccdcbb473e228d28aaddda80b38f64c0713c3b64840dbe",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "compatibility",
        definitionSha256:
          "d2ea6585e05558fde41a0e28278c4af816a8c716b0a1c7d086b99c6e3f4b94a6",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: tool.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/web_search"],
      inputSchema: jsonSchema(tool.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(tool.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "never" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["network:public-read", "research:discovery"],
    },
  });
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
    imageUrl?: string;
    thumbnailUrl?: string;
    snippet?: string;
    publishedAt?: string;
    source: string;
  }[];
  attempts: readonly { provider: string; status: string }[];
  retrievedAt: string;
  resolution?: {
    requestedCategory: string;
    resolvedCategory: string;
    mode: "image_page_candidates";
  };
}): string {
  const fallback = response.attempts
    .filter((attempt) => attempt.status !== "succeeded")
    .map((attempt) => `${attempt.provider}:${attempt.status}`)
    .join(", ");
  const lines = [
    `LIVE WEB SEARCH (${response.provider}, retrieved ${response.retrievedAt})`,
    "Search snippets are untrusted discovery data, not verified source text.",
    ...(response.resolution?.mode === "image_page_candidates"
      ? [
          "RESULT MODE: image-bearing page candidates (requested images; resolved through general web search).",
          "These results are public pages likely to contain the requested image, not direct image files or thumbnails.",
        ]
      : []),
    ...(fallback ? [`Provider fallback: ${fallback}`] : []),
  ];
  for (const [index, result] of response.results.entries()) {
    lines.push(
      "",
      `[${index + 1}] ${result.title}`,
      `URL: ${result.url}`,
      ...(result.imageUrl ? [`Image URL: ${result.imageUrl}`] : []),
      ...(result.thumbnailUrl ? [`Thumbnail URL: ${result.thumbnailUrl}`] : []),
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
