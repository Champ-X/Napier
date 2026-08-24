import { normalizeBoundedText, requestRecord, validThreadId } from "./http-request-validation.js";
import { isSha256Hex } from "./receipt-trust-http-validation-primitives.js";
import type { CreateMcpExtensionRequest, ExtensionCapability, McpToolEffect, McpTransportConfig, RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest, ReviewExtensionRequest, ReviewMcpToolRequest, SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest, SetExtensionEnabledRequest, SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest, VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest, VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest, VerifyUsagePriceTableCatalogRequest } from "@napier/contracts";

export const MAX_EVALUATION_REQUEST_BYTES = 64 * 1024;

export const MAX_EXTENSION_ADMIN_REQUEST_BYTES = 64 * 1024;

export const MAX_TRUST_ADMIN_REQUEST_BYTES = 8 * 1024;

export const MAX_PACKAGE_GOVERNANCE_REQUEST_BYTES = 64 * 1024;

export function parseVerifyUsagePriceTableCatalogRequest(input: unknown): VerifyUsagePriceTableCatalogRequest | undefined {
  if (!input || Array.isArray(input) || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const catalog = record["catalog"];
  if (!catalog || Array.isArray(catalog) || typeof catalog !== "object") {
    return undefined;
  }
  const requiredProviders = record["requiredProviders"];
  if (requiredProviders === undefined) {
    return {
      catalog: catalog as VerifyUsagePriceTableCatalogRequest["catalog"],
    };
  }
  if (!Array.isArray(requiredProviders) || requiredProviders.length > 20 || !requiredProviders.every((provider) => typeof provider === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(provider))) {
    return undefined;
  }
  return {
    catalog: catalog as VerifyUsagePriceTableCatalogRequest["catalog"],
    requiredProviders,
  };
}

function validAgentId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{2,80}$/.test(value);
}

export function parseCreateMcpExtensionRequest(input: unknown): CreateMcpExtensionRequest | undefined {
  const record = requestRecord(input, ["name", "description", "version", "transport", "requestedCapabilities", "threadId"]);
  const name = normalizeBoundedText(record?.["name"], 1, 80);
  const description = record?.["description"] === undefined ? undefined : normalizeBoundedText(record["description"], 0, 500);
  const version = record?.["version"] === undefined ? undefined : normalizeBoundedText(record["version"], 1, 64);
  const transport = parseMcpTransport(record?.["transport"]);
  const requestedCapabilities = record?.["requestedCapabilities"] === undefined ? undefined : parseExtensionCapabilities(record["requestedCapabilities"]);
  const threadId = record?.["threadId"];
  if (!record || !name || (record["description"] !== undefined && description === undefined) || (record["version"] !== undefined && !version) || !transport || (record["requestedCapabilities"] !== undefined && !requestedCapabilities) || (threadId !== undefined && !validThreadId(threadId))) {
    return undefined;
  }
  return {
    name,
    ...(description ? { description } : {}),
    ...(version ? { version } : {}),
    transport,
    ...(requestedCapabilities ? { requestedCapabilities } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseReviewExtensionRequest(input: unknown): ReviewExtensionRequest | undefined {
  const record = requestRecord(input, ["action", "approvedCapabilities", "note", "threadId"]);
  const action = record?.["action"];
  const approvedCapabilities = record?.["approvedCapabilities"] === undefined ? undefined : parseExtensionCapabilities(record["approvedCapabilities"]);
  const note = parseOptionalBoundedText(record?.["note"], 500);
  const threadId = record?.["threadId"];
  if (!record || (action !== "approve" && action !== "reject") || (record["approvedCapabilities"] !== undefined && !approvedCapabilities) || (record["note"] !== undefined && note === undefined) || (threadId !== undefined && !validThreadId(threadId))) {
    return undefined;
  }
  return {
    action,
    ...(approvedCapabilities ? { approvedCapabilities } : {}),
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseSetExtensionEnabledRequest(input: unknown): SetExtensionEnabledRequest | undefined {
  const record = requestRecord(input, ["agentId", "enabled", "threadId"]);
  const agentId = record?.["agentId"];
  const enabled = record?.["enabled"];
  const threadId = record?.["threadId"];
  return record && validAgentId(agentId) && typeof enabled === "boolean" && (threadId === undefined || validThreadId(threadId))
    ? {
        agentId,
        enabled,
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

export function parseExtensionThreadContextRequest(input: unknown): { threadId?: string } | undefined {
  if (input === undefined) return {};
  const record = requestRecord(input, ["threadId"]);
  const threadId = record?.["threadId"];
  return record && (threadId === undefined || validThreadId(threadId))
    ? {
        ...(typeof threadId === "string" ? { threadId } : {}),
      }
    : undefined;
}

export function parseReviewMcpToolRequest(input: unknown): (ReviewMcpToolRequest & { toolName: string }) | undefined {
  const record = requestRecord(input, ["toolName", "action", "effect", "routingHint", "note", "threadId"]);
  const toolName = parseProcessText(record?.["toolName"], 1, 160);
  const action = record?.["action"];
  const effect = parseMcpToolEffect(record?.["effect"]);
  const routingHint = record?.["routingHint"] === undefined ? undefined : parseReviewedRoutingHint(record["routingHint"]);
  const note = parseOptionalBoundedText(record?.["note"], 500);
  const threadId = record?.["threadId"];
  if (!record || !toolName || (action !== "approve" && action !== "reject") || (record["effect"] !== undefined && !effect) || (record["routingHint"] !== undefined && !routingHint) || (record["note"] !== undefined && note === undefined) || (threadId !== undefined && !validThreadId(threadId))) {
    return undefined;
  }
  return {
    toolName,
    action,
    ...(effect ? { effect } : {}),
    ...(routingHint ? { routingHint } : {}),
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

export function parseMcpTransport(input: unknown): McpTransportConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const type = (input as Record<string, unknown>)["type"];
  if (type === "streamable_http") {
    return parseStreamableHttpTransport(input);
  }
  if (type === "stdio") {
    return parseStdioTransport(input);
  }
  return undefined;
}

function parseStreamableHttpTransport(
  input: object,
): McpTransportConfig | undefined {
  const record = requestRecord(input, ["type", "url", "headerEnv"]);
  const url = parseProcessText(record?.["url"], 1, 2_000);
  const headerEnv =
    record?.["headerEnv"] === undefined
      ? undefined
      : parseEnvironmentMap(record["headerEnv"], {
          keyPattern: /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/,
        });
  if (!record || !url || (record["headerEnv"] !== undefined && !headerEnv)) {
    return undefined;
  }
  return {
    type: "streamable_http",
    url,
    ...(headerEnv ? { headerEnv } : {}),
  };
}

function parseStdioTransport(input: object): McpTransportConfig | undefined {
  const record = requestRecord(input, ["type", "command", "args", "cwd", "env"]);
  const command = parseProcessText(record?.["command"], 1, 500);
  const args = record?.["args"] === undefined ? undefined : parseProcessTextArray(record["args"], 50, 1_000, true);
  const cwd = record?.["cwd"] === undefined ? undefined : parseProcessText(record["cwd"], 1, 1_000);
  const env = record?.["env"] === undefined ? undefined : parseEnvironmentMap(record["env"]);
  if (!record || !command || (record["args"] !== undefined && !args) || (record["cwd"] !== undefined && !cwd) || (record["env"] !== undefined && !env)) {
    return undefined;
  }
  return {
    type: "stdio",
    command,
    ...(args ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(env ? { env } : {}),
  };
}

export function parseExtensionCapabilities(input: unknown): ExtensionCapability[] | undefined {
  if (!Array.isArray(input) || input.length > 7) return undefined;
  const output: ExtensionCapability[] = [];
  for (const value of input) {
    if (value !== "network.connect" && value !== "secrets.env" && value !== "process.spawn" && value !== "workspace.read" && value !== "workspace.write" && value !== "external.read" && value !== "external.write") {
      return undefined;
    }
    output.push(value);
  }
  const unique = new Set(output);
  return unique.size === output.length ? [...unique].sort() : undefined;
}

export function parseMcpToolEffect(input: unknown): McpToolEffect | undefined {
  return input === "read" || input === "write" || input === "unknown" ? input : undefined;
}

export function parseEnvironmentMap(input: unknown, options: { keyPattern?: RegExp } = {}): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 64) return undefined;
  const keyPattern = options.keyPattern ?? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
  const output: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!keyPattern.test(key) || typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)) {
      return undefined;
    }
    output[key] = value;
  }
  return output;
}

export function parseProcessTextArray(input: unknown, maxItems: number, maxLength: number, allowEmpty = false): string[] | undefined {
  if (!Array.isArray(input) || input.length > maxItems) return undefined;
  const output: string[] = [];
  for (const value of input) {
    const item = parseProcessText(value, allowEmpty ? 0 : 1, maxLength);
    if (item === undefined) return undefined;
    output.push(item);
  }
  return output;
}

export function parseProcessText(input: unknown, minLength: number, maxLength: number): string | undefined {
  if (typeof input !== "string" || /[\u0000-\u001f\u007f]/.test(input)) {
    return undefined;
  }
  const normalized = input.trim();
  return normalized.length >= minLength && normalized.length <= maxLength ? normalized : undefined;
}

export function parseReviewedRoutingHint(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= 500 && !/[\u0000-\u001f\u007f<>]/.test(normalized) ? normalized : undefined;
}

export function parseOptionalBoundedText(input: unknown, maxLength: number): string | undefined {
  if (input === undefined) return "";
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : undefined;
}

export function parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest(input: unknown): VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryRequest | undefined {
  const record = requestRecord(input, ["history"]);
  if (!record || record["history"] === undefined) return undefined;
  return {
    history: record["history"],
  };
}

export function parseVerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(input: unknown): VerifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest | undefined {
  const record = requestRecord(input, ["histories"]);
  if (!record || !Array.isArray(record["histories"])) return undefined;
  return {
    histories: record["histories"],
  };
}

export function parseSignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest(input: unknown): SignExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleRequest | undefined {
  const record = requestRecord(input, ["histories", "threadId", "trustAnchorId"]);
  const threadId = record?.["threadId"];
  const trustAnchorId = record?.["trustAnchorId"];
  return record && Array.isArray(record["histories"]) && validThreadId(threadId) && typeof trustAnchorId === "string" && /^trustkey_[a-z0-9]{8,80}$/.test(trustAnchorId)
    ? {
        histories: record["histories"],
        threadId,
        trustAnchorId,
      }
    : undefined;
}

export function parseSetExecutionPlanBlueprintRecommendationPolicyOverrideRequest(input: unknown): SetExecutionPlanBlueprintRecommendationPolicyOverrideRequest | undefined {
  const record = requestRecord(input, ["familySha256", "policyTemplate", "expectedPortfolioSetSha256"]);
  if (!record) return undefined;
  const familySha256 = record["familySha256"];
  const policyTemplate = record["policyTemplate"];
  const expectedPortfolioSetSha256 = record["expectedPortfolioSetSha256"];
  if (!isSha256Hex(familySha256) || (policyTemplate !== "balanced" && policyTemplate !== "delivery_first" && policyTemplate !== "portfolio_first") || (expectedPortfolioSetSha256 !== undefined && !isSha256Hex(expectedPortfolioSetSha256))) {
    return undefined;
  }
  return {
    familySha256,
    policyTemplate,
    ...(expectedPortfolioSetSha256 ? { expectedPortfolioSetSha256 } : {}),
  };
}

export function parseRetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest(input: unknown): RetireExecutionPlanBlueprintRecommendationPolicyOverrideRequest | undefined {
  const record = requestRecord(input, ["familySha256", "expectedOverrideSha256", "expectedOverrideSetSha256", "expectedDriftReviewSetSha256", "expectedPortfolioSetSha256"]);
  if (!record) return undefined;
  const familySha256 = record["familySha256"];
  const expectedOverrideSha256 = record["expectedOverrideSha256"];
  const expectedOverrideSetSha256 = record["expectedOverrideSetSha256"];
  const expectedDriftReviewSetSha256 = record["expectedDriftReviewSetSha256"];
  const expectedPortfolioSetSha256 = record["expectedPortfolioSetSha256"];
  if (!isSha256Hex(familySha256) || !isSha256Hex(expectedOverrideSha256) || !isSha256Hex(expectedOverrideSetSha256) || !isSha256Hex(expectedDriftReviewSetSha256) || !isSha256Hex(expectedPortfolioSetSha256)) {
    return undefined;
  }
  return {
    familySha256,
    expectedOverrideSha256,
    expectedOverrideSetSha256,
    expectedDriftReviewSetSha256,
    expectedPortfolioSetSha256,
  };
}

