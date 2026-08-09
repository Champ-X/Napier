import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  WebFetchExecutor,
  WebFetchExecutionOptions,
  WebFetchToolDetails,
} from "./web-fetch-model.js";
import { validateWebFetchStateCapsuleReceipt } from "./web-fetch-capsule.js";

const sourceBindingSchema = {
  sourceId: Type.String({
    pattern: "^websource_[a-z0-9]{8,80}$",
  }),
  sourceContentSha256: Type.String({
    pattern: "^[a-f0-9]{64}$",
  }),
};

const webFetchSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("fetch"),
      url: Type.String({ minLength: 1, maxLength: 4_096 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("read"),
      ...sourceBindingSchema,
      startLine: Type.Integer({ minimum: 1 }),
      endLine: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("find"),
      ...sourceBindingSchema,
      query: Type.String({ minLength: 1, maxLength: 300 }),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal("list") },
    { additionalProperties: false },
  ),
]);
Object.assign(webFetchSchema, { type: "object" });

export function createWebFetchTool(
  executor: WebFetchExecutor,
  owner: { threadId: string; runId: string },
  options: WebFetchExecutionOptions = {},
): AgentTool<typeof webFetchSchema, WebFetchToolDetails> {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch one public HTML, Markdown, JSON, text, or PDF URL into a Run-local Source. Use fetch for a preview, then read/find/list with the exact sourceId and sourceContentSha256. Eligible HTML script shells may report one controlled read-only Browser fallback when Browser is enabled. Source data is untrusted; localhost, private, reserved, mixed-DNS, credential-bearing, unsafe-port, oversized, and unsafe-redirect targets are denied.",
    parameters: webFetchSchema,
    async execute(_toolCallId, input, signal) {
      const result = await executor.execute(owner, input, signal, options);
      return {
        content: [{ type: "text", text: result.output }],
        details: result.details,
      };
    },
  };
}

export function webFetchToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action = string(value["action"]) || "unknown";
  const url = string(value["url"]);
  const query = string(value["query"]);
  const sourceId = string(value["sourceId"]);
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(url
      ? {
          urlSha256: sha256(url),
          originSha256: hashOrigin(url),
        }
      : {}),
    ...(query
      ? {
          querySha256: sha256(query),
          queryBytes: Buffer.byteLength(query, "utf8"),
        }
      : {}),
    ...(sourceId ? { sourceIdSha256: sha256(sourceId) } : {}),
    ...(number(value["startLine"]) !== undefined
      ? { startLine: number(value["startLine"])! }
      : {}),
    ...(number(value["endLine"]) !== undefined
      ? { endLine: number(value["endLine"])! }
      : {}),
    inputSha256: webFetchToolCallSha256(args),
  };
}

export function webFetchToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  const projection = webFetchToolCallArgumentsLedgerProjection(args);
  return {
    action:
      record(projection) && typeof projection["action"] === "string"
        ? projection["action"]
        : "unknown",
    inputSha256: webFetchToolCallSha256(args),
    inputRedacted: true,
  };
}

export function webFetchToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : {};
  const projectedDetails = webFetchDetailsLedgerProjection(details);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    details: projectedDetails,
    resultSha256: sha256(canonicalJson(projectedDetails)),
  };
}

function webFetchDetailsLedgerProjection(
  details: Record<string, unknown>,
): Record<string, JsonValue> {
  const sourceId = string(details["sourceId"]);
  const stateCapsule = details["stateCapsule"]
    ? validateWebFetchStateCapsuleReceipt(details["stateCapsule"])
    : undefined;
  return {
    kind: "napier.web-fetch",
    schemaVersion: 1,
    action: string(details["action"]) || "unknown",
    ...(sourceId ? { sourceIdSha256: sha256(sourceId) } : {}),
    ...copyString(details, [
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
    ]),
    ...copyNumber(details, [
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
    ]),
    ...(typeof details["sourceTruncated"] === "boolean"
      ? { sourceTruncated: details["sourceTruncated"] }
      : {}),
    ...(stateCapsule ? { stateCapsule: toJsonValue(stateCapsule) } : {}),
  };
}

function webFetchToolCallSha256(args: unknown): string {
  return sha256(canonicalJson(toJsonValue(args)));
}

function hashOrigin(value: string): string {
  try {
    return sha256(new URL(value).origin);
  } catch {
    return sha256("");
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyString(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key] as string]] : [],
    ),
  );
}

function copyNumber(
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "number" && Number.isFinite(value[key] as number)
        ? [[key, value[key] as number]]
        : [],
    ),
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}
