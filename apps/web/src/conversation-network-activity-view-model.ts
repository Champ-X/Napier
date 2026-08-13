import type { RunEvent } from "@napier/contracts";

export type ConversationNetworkActivity =
  | {
      kind: "search";
      id: string;
      callId: string;
      seq: number;
      createdAt: string;
      status: "working" | "completed" | "failed";
      provider?: string;
      category?: "general" | "news" | "images";
      resultCount?: number;
      attemptedProviderCount?: number;
      failedProviderCount?: number;
      unavailableProviderCount?: number;
      retrievedAt?: string;
    }
  | {
      kind: "fetch";
      id: string;
      callId: string;
      seq: number;
      createdAt: string;
      status: "working" | "completed" | "failed";
      action?: "fetch" | "read" | "find" | "list";
      format?: "html" | "markdown" | "json" | "text" | "pdf";
      lineCount?: number;
      pageCount?: number;
      sourceCount?: number;
      renderMode?: "static" | "browser_fallback";
      fallbackStatus?: "not_needed" | "used" | "unavailable";
      fallbackDiagnostic?:
        | "browser_unavailable"
        | "browser_render_not_useful"
        | "fallback_limit_reached"
        | "login_required"
        | "challenge_detected";
      redirectCount?: number;
      retrievedAt?: string;
    };

const EVENT = /^tool\.(started|completed|failed)$/u;
const CALL_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SEARCH_PROVIDERS = new Set([
  "firecrawl",
  "brave",
  "tavily",
  "bing",
  "duckduckgo",
]);
const SEARCH_DETAIL_KEYS = new Set([
  "kind",
  "schemaVersion",
  "provider",
  "category",
  "resultCount",
  "attemptedProviderCount",
  "failedProviderCount",
  "unavailableProviderCount",
  "querySha256",
  "resultSetSha256",
  "retrievedAt",
]);
const FETCH_DETAIL_KEYS = new Set([
  "kind",
  "schemaVersion",
  "action",
  "sourceIdSha256",
  "sourceFormat",
  "sourceContentSha256",
  "sourceUrlSha256",
  "sourceOriginSha256",
  "sourceTitleSha256",
  "sourceAuthorSha256",
  "sourcePublishedAtSha256",
  "sourceBodySha256",
  "findQuerySha256",
  "sourceSetSha256",
  "retrievedAt",
  "sourceRenderMode",
  "browserFallbackStatus",
  "browserFallbackDiagnostic",
  "browserSessionIdSha256",
  "browserActiveTabId",
  "browserTabSetSha256",
  "browserExecutableSha256",
  "browserVersionSha256",
  "browserLimitsSha256",
  "browserNetworkDestinationsSha256",
  "urlArtifactRegistration",
  "sourceBodyBytes",
  "sourceLineCount",
  "sourceTextChars",
  "sourcePageCount",
  "redirectCount",
  "readStartLine",
  "readEndLine",
  "readLineCount",
  "findMatchCount",
  "sourceCount",
  "browserFallbackCount",
  "browserSessionOperation",
  "browserTabCount",
  "browserNetworkRequestCount",
  "browserNetworkConnectCount",
  "browserNetworkRejectedCount",
  "browserNetworkTransferredBytes",
  "browserNetworkDestinationCount",
  "sourceTruncated",
  "stateCapsule",
]);

export function conversationNetworkActivities(
  events: RunEvent[],
  limit = 8,
): ConversationNetworkActivity[] {
  const latest = new Map<string, ConversationNetworkActivity>();
  for (const event of events) {
    const activity = conversationNetworkActivity(event);
    if (activity) latest.set(activity.callId, activity);
  }
  return [...latest.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationNetworkActivity(
  event: RunEvent,
): ConversationNetworkActivity | undefined {
  if (event.visibility !== "user" || !EVENT.test(event.type)) return undefined;
  const payload = record(event.payload);
  const callId = safeString(payload?.["callId"], CALL_ID);
  const toolName = payload?.["toolName"];
  if (
    !payload ||
    !callId ||
    (toolName !== "web_search" && toolName !== "web_fetch")
  ) {
    return undefined;
  }
  const status =
    event.type === "tool.started"
      ? "working"
      : event.type === "tool.completed"
        ? "completed"
        : "failed";
  const base = {
    id: event.id,
    callId,
    seq: event.seq,
    createdAt: event.createdAt,
    status,
  } as const;
  if (toolName === "web_search") {
    if (status !== "completed") return { kind: "search", ...base };
    const details = searchDetails(payload["details"]);
    return { kind: "search", ...base, ...(details ?? {}) };
  }
  if (status !== "completed") {
    const action = fetchAction(payload["action"]);
    return { kind: "fetch", ...base, ...(action ? { action } : {}) };
  }
  const details = fetchDetails(payload["details"]);
  return { kind: "fetch", ...base, ...(details ?? {}) };
}

function searchDetails(value: unknown) {
  const details = exactRecord(value, SEARCH_DETAIL_KEYS);
  const provider = safeString(details?.["provider"], SEARCH_PROVIDERS);
  const category = searchCategory(details?.["category"]);
  const resultCount = integer(details?.["resultCount"], 0, 20);
  const attemptedProviderCount = integer(
    details?.["attemptedProviderCount"],
    1,
    6,
  );
  const failedProviderCount = integer(details?.["failedProviderCount"], 0, 6);
  const unavailableProviderCount = integer(
    details?.["unavailableProviderCount"],
    0,
    6,
  );
  const retrievedAt = isoDate(details?.["retrievedAt"]);
  if (
    details?.["kind"] !== "napier.web-search" ||
    details["schemaVersion"] !== 1 ||
    !provider ||
    !category ||
    resultCount === undefined ||
    attemptedProviderCount === undefined ||
    failedProviderCount === undefined ||
    unavailableProviderCount === undefined ||
    failedProviderCount + unavailableProviderCount > attemptedProviderCount ||
    !sha256(details["querySha256"]) ||
    !sha256(details["resultSetSha256"]) ||
    !retrievedAt
  ) {
    return undefined;
  }
  return {
    provider,
    category,
    resultCount,
    attemptedProviderCount,
    failedProviderCount,
    unavailableProviderCount,
    retrievedAt,
  };
}

function fetchDetails(value: unknown) {
  const details = exactRecord(value, FETCH_DETAIL_KEYS);
  const action = fetchAction(details?.["action"]);
  const sourceCount = integer(details?.["sourceCount"], 0, 16);
  if (
    details?.["kind"] !== "napier.web-fetch" ||
    details["schemaVersion"] !== 1 ||
    !action ||
    sourceCount === undefined ||
    !sha256(details["sourceSetSha256"])
  ) {
    return undefined;
  }
  const format = sourceFormat(details["sourceFormat"]);
  const lineCount = integer(details["sourceLineCount"], 1, 20_000);
  const pageCount = integer(details["sourcePageCount"], 1, 10_000);
  const renderMode = sourceRenderMode(details["sourceRenderMode"]);
  const fallbackStatus = browserFallbackStatus(
    details["browserFallbackStatus"],
  );
  const redirectCount = integer(details["redirectCount"], 0, 10);
  const retrievedAt = isoDate(details["retrievedAt"]);
  const fallbackDiagnostic = browserFallbackDiagnostic(
    details["browserFallbackDiagnostic"],
  );
  if (
    action === "fetch" &&
    (!format ||
      lineCount === undefined ||
      !renderMode ||
      !fallbackStatus ||
      !retrievedAt ||
      !sha256(details["sourceContentSha256"]) ||
      !sha256(details["sourceBodySha256"]))
  ) {
    return undefined;
  }
  if (
    (fallbackStatus === "unavailable") !== Boolean(fallbackDiagnostic) ||
    (fallbackStatus !== "used" && renderMode === "browser_fallback")
  ) {
    return undefined;
  }
  return {
    action,
    sourceCount,
    ...(format ? { format } : {}),
    ...(lineCount !== undefined ? { lineCount } : {}),
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(renderMode ? { renderMode } : {}),
    ...(fallbackStatus ? { fallbackStatus } : {}),
    ...(fallbackDiagnostic ? { fallbackDiagnostic } : {}),
    ...(redirectCount !== undefined ? { redirectCount } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
  };
}

function exactRecord(
  value: unknown,
  allowed: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const output = record(value);
  return output && Object.keys(output).every((key) => allowed.has(key))
    ? output
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeString(
  value: unknown,
  allowed: RegExp | ReadonlySet<string>,
): string | undefined {
  if (typeof value !== "string") return undefined;
  return allowed instanceof RegExp
    ? allowed.test(value)
      ? value
      : undefined
    : allowed.has(value)
      ? value
      : undefined;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? value : undefined;
}

function searchCategory(
  value: unknown,
): "general" | "news" | "images" | undefined {
  return value === "general" || value === "news" || value === "images"
    ? value
    : undefined;
}

function fetchAction(
  value: unknown,
): "fetch" | "read" | "find" | "list" | undefined {
  return value === "fetch" ||
    value === "read" ||
    value === "find" ||
    value === "list"
    ? value
    : undefined;
}

function sourceFormat(
  value: unknown,
): "html" | "markdown" | "json" | "text" | "pdf" | undefined {
  return value === "html" ||
    value === "markdown" ||
    value === "json" ||
    value === "text" ||
    value === "pdf"
    ? value
    : undefined;
}

function sourceRenderMode(
  value: unknown,
): "static" | "browser_fallback" | undefined {
  return value === "static" || value === "browser_fallback" ? value : undefined;
}

function browserFallbackStatus(
  value: unknown,
): "not_needed" | "used" | "unavailable" | undefined {
  return value === "not_needed" || value === "used" || value === "unavailable"
    ? value
    : undefined;
}

function browserFallbackDiagnostic(
  value: unknown,
):
  | "browser_unavailable"
  | "browser_render_not_useful"
  | "fallback_limit_reached"
  | "login_required"
  | "challenge_detected"
  | undefined {
  return value === "browser_unavailable" ||
    value === "browser_render_not_useful" ||
    value === "fallback_limit_reached" ||
    value === "login_required" ||
    value === "challenge_detected"
    ? value
    : undefined;
}
