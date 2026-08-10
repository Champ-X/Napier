import { createHash } from "node:crypto";
import path from "node:path";

import type {
  CreateMcpExtensionRequest,
  ExtensionCapability,
  ExtensionConnection,
  ExtensionRecord,
  JsonValue,
  McpToolEffect,
  McpToolRecord,
  ReviewExtensionRequest,
  ReviewMcpToolRequest,
} from "@napier/contracts";

import { createId, nowIso } from "./ids.js";
import { EXTENSION_CAPABILITIES } from "./extension-capabilities.js";

const CAPABILITIES: ReadonlySet<ExtensionCapability> = EXTENSION_CAPABILITIES;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const RESERVED_MCP_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "cookie",
  "host",
  "mcp-protocol-version",
  "mcp-session-id",
  "origin",
  "referer",
  "set-cookie",
  "transfer-encoding",
]);

export interface DiscoveredMcpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export function createMcpExtension(
  request: CreateMcpExtensionRequest,
): ExtensionRecord {
  const name = normalizeRequiredText(request.name, "Extension name", 80);
  const normalizedName = normalizeMcpName(name, 24);
  const description = normalizeText(request.description ?? "", 500);
  const version = normalizeText(request.version ?? "unversioned", 64);
  const transport = normalizeTransport(request.transport);
  const requiredCapabilities = requiredTransportCapabilities(transport);
  const requested = request.requestedCapabilities ?? [];
  const requestedCapabilities = normalizeCapabilities([
    ...requiredCapabilities,
    ...requested,
    ...(requested.includes("workspace.write")
      ? (["workspace.read"] as const)
      : []),
  ]);
  const timestamp = nowIso();
  const locator =
    transport.type === "streamable_http"
      ? transport.url
      : [transport.command, ...(transport.args ?? [])].join(" ");
  const digestSha256 = sha256(
    canonicalJson({
      kind: "mcp",
      name,
      version,
      transport,
      requestedCapabilities,
    }),
  );

  return {
    id: createId("ext"),
    kind: "mcp",
    name,
    normalizedName,
    description,
    version,
    provenance: {
      source: "manual",
      locator,
      digestSha256,
    },
    requestedCapabilities,
    approvedCapabilities: [],
    trustStatus: "pending",
    enabledAgentIds: [],
    transport,
    connection: {
      status: "untested",
      toolCount: 0,
    },
    tools: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function reviewExtensionRecord(
  current: ExtensionRecord,
  request: ReviewExtensionRequest,
): ExtensionRecord {
  const timestamp = nowIso();
  if (request.action === "reject") {
    return {
      ...current,
      trustStatus: "rejected",
      approvedCapabilities: [],
      enabledAgentIds: [],
      connection: { status: "disconnected", toolCount: current.tools.length },
      tools: current.tools.map((tool) => ({
        ...tool,
        reviewStatus: "pending",
        effect: "unknown",
      })),
      ...(request.note ? { reviewNote: normalizeText(request.note, 500) } : {}),
      reviewedAt: timestamp,
      updatedAt: timestamp,
      revision: current.revision + 1,
    };
  }

  const approvedCapabilities = normalizeCapabilities(
    request.approvedCapabilities ?? current.requestedCapabilities,
  );
  for (const capability of approvedCapabilities) {
    if (!current.requestedCapabilities.includes(capability)) {
      throw new Error(`Capability was not requested: ${capability}`);
    }
  }
  for (const capability of requiredTransportCapabilities(current.transport)) {
    if (!approvedCapabilities.includes(capability)) {
      throw new Error(`Transport requires approved capability: ${capability}`);
    }
  }
  return {
    ...current,
    trustStatus: "approved",
    approvedCapabilities,
    ...(request.note ? { reviewNote: normalizeText(request.note, 500) } : {}),
    reviewedAt: timestamp,
    updatedAt: timestamp,
    revision: current.revision + 1,
  };
}

export function setExtensionAgentEnabled(
  current: ExtensionRecord,
  agentId: string,
  enabled: boolean,
): ExtensionRecord {
  if (enabled && current.trustStatus !== "approved") {
    throw new Error("Only approved extensions can be enabled");
  }
  const enabledAgentIds = new Set(current.enabledAgentIds);
  if (enabled) enabledAgentIds.add(agentId);
  else enabledAgentIds.delete(agentId);
  return {
    ...current,
    enabledAgentIds: [...enabledAgentIds].sort(),
    updatedAt: nowIso(),
    revision: current.revision + 1,
  };
}

export function mergeDiscoveredMcpTools(
  current: ExtensionRecord,
  discovered: DiscoveredMcpTool[],
): ExtensionRecord {
  const normalized = discovered.map((tool) => {
    const name = normalizeRequiredText(tool.name, "MCP tool name", 160);
    const normalizedName = normalizeMcpName(name, 28);
    return { source: tool, name, normalizedName };
  });
  const names = new Set<string>();
  for (const tool of normalized) {
    if (names.has(tool.normalizedName)) {
      throw new Error(
        `MCP tool names collide after normalization: ${tool.normalizedName}`,
      );
    }
    names.add(tool.normalizedName);
  }
  const tools = normalized.map(({ source, name, normalizedName }) => {
    const inputSchema = normalizeInputSchema(source.inputSchema);
    const schemaSha256 = sha256(canonicalJson(inputSchema));
    const signedTool = current.packageBinding?.envelope.manifest.tools.find(
      (tool) => tool.name === name && tool.schemaSha256 === schemaSha256,
    );
    const existing = current.tools.find(
      (tool) =>
        tool.name === name &&
        tool.normalizedName === normalizedName &&
        tool.schemaSha256 === schemaSha256,
    );
    const base: McpToolRecord = {
      name,
      normalizedName,
      directName: `mcp__${current.normalizedName}__${normalizedName}`,
      description: sanitizeUntrustedText(source.description ?? "", 1_000),
      ...(existing?.routingHint
        ? { routingHint: existing.routingHint }
        : signedTool?.routingHint
          ? { routingHint: signedTool.routingHint }
          : {}),
      inputSchema,
      schemaSha256,
      reviewStatus: existing?.reviewStatus ?? "pending",
      effect: existing?.effect ?? "unknown",
    };
    return {
      ...base,
      ...(existing?.reviewNote ? { reviewNote: existing.reviewNote } : {}),
      ...(existing?.reviewedAt ? { reviewedAt: existing.reviewedAt } : {}),
    };
  });
  if (current.packageBinding) {
    const expected = current.packageBinding.envelope.manifest.tools.map(
      (tool) => ({
        name: tool.name,
        normalizedName: tool.normalizedName,
        schemaSha256: tool.schemaSha256,
      }),
    );
    const observed = tools
      .map((tool) => ({
        name: tool.name,
        normalizedName: tool.normalizedName,
        schemaSha256: tool.schemaSha256,
      }))
      .sort((left, right) =>
        left.normalizedName.localeCompare(right.normalizedName),
      );
    if (canonicalJson(expected) !== canonicalJson(observed)) {
      throw new Error(
        "Discovered MCP tool catalog differs from the signed package manifest",
      );
    }
  }
  return {
    ...current,
    tools,
    connection: {
      status: "ready",
      toolCount: tools.length,
      testedAt: nowIso(),
    },
    updatedAt: nowIso(),
    revision: current.revision + 1,
  };
}

export function reviewMcpToolRecord(
  current: ExtensionRecord,
  toolName: string,
  request: ReviewMcpToolRequest,
): ExtensionRecord {
  if (current.trustStatus !== "approved") {
    throw new Error("Extension must be approved before its tools are reviewed");
  }
  const index = current.tools.findIndex(
    (tool) => tool.name === toolName || tool.directName === toolName,
  );
  const tool = current.tools[index];
  if (!tool) throw new Error(`MCP tool not found: ${toolName}`);
  let effect: McpToolEffect = "unknown";
  if (request.action === "approve") {
    if (request.effect !== "read" && request.effect !== "write") {
      throw new Error("Approved MCP tools require a read or write effect");
    }
    effect = request.effect;
    const signedEffect = current.packageBinding?.envelope.manifest.tools.find(
      (candidate) =>
        candidate.name === tool.name &&
        candidate.schemaSha256 === tool.schemaSha256,
    )?.effect;
    if (signedEffect && signedEffect !== effect) {
      throw new Error(
        `Tool effect differs from signed package manifest: expected ${signedEffect}`,
      );
    }
    const capability = effect === "read" ? "external.read" : "external.write";
    if (!current.approvedCapabilities.includes(capability)) {
      throw new Error(
        `Tool effect requires approved capability: ${capability}`,
      );
    }
  }
  const timestamp = nowIso();
  const reviewedRoutingHint =
    request.action === "approve"
      ? (request.routingHint ?? tool.routingHint)
      : undefined;
  const { routingHint: _routingHint, ...toolWithoutRoutingHint } = tool;
  const updatedTool: McpToolRecord = {
    ...toolWithoutRoutingHint,
    reviewStatus: request.action === "approve" ? "approved" : "rejected",
    effect,
    ...(reviewedRoutingHint
      ? { routingHint: normalizeReviewedRoutingHint(reviewedRoutingHint) }
      : {}),
    ...(request.note ? { reviewNote: normalizeText(request.note, 500) } : {}),
    reviewedAt: timestamp,
  };
  const tools = [...current.tools];
  tools[index] = updatedTool;
  return {
    ...current,
    tools,
    updatedAt: timestamp,
    revision: current.revision + 1,
  };
}

export function updateExtensionConnection(
  current: ExtensionRecord,
  connection: ExtensionConnection,
): ExtensionRecord {
  return {
    ...current,
    connection,
    updatedAt: nowIso(),
    revision: current.revision + 1,
  };
}

export function normalizeMcpName(value: string, maxLength = 28): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, maxLength);
  if (!normalized) throw new Error("Name must contain letters or numbers");
  return normalized;
}

export function sanitizeUntrustedText(
  value: string,
  maxLength: number,
): string {
  return normalizeText(
    value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[<>]/g, (character) => (character === "<" ? "[" : "]")),
    maxLength,
  );
}

function normalizeReviewedRoutingHint(value: string): string {
  const hint = normalizeText(value.replace(/\s+/g, " "), 500);
  if (!hint) throw new Error("Reviewed routing hint must not be empty");
  if (/[\u0000-\u001f\u007f<>]/.test(hint)) {
    throw new Error("Reviewed routing hint contains unsupported characters");
  }
  return hint;
}

function normalizeTransport(
  transport: CreateMcpExtensionRequest["transport"],
): CreateMcpExtensionRequest["transport"] {
  if (transport.type === "streamable_http") {
    const url = new URL(transport.url);
    if (url.username || url.password) {
      throw new Error("MCP URLs must not contain credentials");
    }
    if (url.hash) throw new Error("MCP URLs must not contain fragments");
    if (url.search) {
      throw new Error(
        "MCP URLs must not contain query parameters; use environment-backed headers",
      );
    }
    const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error(
        "Remote MCP endpoints require HTTPS; HTTP is limited to loopback",
      );
    }
    const headerEnv: Record<string, string> = {};
    for (const [header, envName] of Object.entries(transport.headerEnv ?? {})) {
      if (!HEADER_NAME.test(header)) {
        throw new Error(`Invalid MCP header name: ${header}`);
      }
      if (RESERVED_MCP_HEADERS.has(header.toLowerCase())) {
        throw new Error(`MCP header is reserved by the transport: ${header}`);
      }
      if (!ENV_NAME.test(envName)) {
        throw new Error(`Invalid MCP environment variable name: ${envName}`);
      }
      headerEnv[header] = envName;
    }
    return {
      type: "streamable_http",
      url: url.toString(),
      ...(Object.keys(headerEnv).length > 0 ? { headerEnv } : {}),
    };
  }

  const command = normalizeProcessValue(
    transport.command,
    "MCP stdio command",
    500,
  );
  if (!path.isAbsolute(command)) {
    throw new Error("MCP stdio command must be an absolute executable path");
  }
  const args = (transport.args ?? [])
    .slice(0, 50)
    .map((argument) =>
      normalizeProcessValue(argument, "MCP stdio argument", 1_000, true),
    );
  const env: Record<string, string> = {};
  for (const [name, sourceName] of Object.entries(transport.env ?? {})) {
    if (!ENV_NAME.test(name) || !ENV_NAME.test(sourceName)) {
      throw new Error("MCP stdio environment must map valid variable names");
    }
    env[name] = sourceName;
  }
  return {
    type: "stdio",
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(transport.cwd
      ? {
          cwd: normalizeProcessValue(transport.cwd, "MCP stdio cwd", 1_000),
        }
      : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

function requiredTransportCapabilities(
  transport: CreateMcpExtensionRequest["transport"],
): ExtensionCapability[] {
  const capabilities: ExtensionCapability[] =
    transport.type === "streamable_http"
      ? ["network.connect"]
      : ["process.spawn"];
  if (transport.type === "stdio" && transport.cwd) {
    capabilities.push("workspace.read");
  }
  const secretCount =
    transport.type === "streamable_http"
      ? Object.keys(transport.headerEnv ?? {}).length
      : Object.keys(transport.env ?? {}).length;
  if (secretCount > 0) capabilities.push("secrets.env");
  return capabilities;
}

function normalizeCapabilities(
  capabilities: ExtensionCapability[],
): ExtensionCapability[] {
  const output = new Set<ExtensionCapability>();
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) {
      throw new Error(`Unknown extension capability: ${String(capability)}`);
    }
    output.add(capability);
  }
  return [...output].sort();
}

function normalizeInputSchema(value: unknown): JsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { type: "object", additionalProperties: true };
  }
  const parsed = JSON.parse(JSON.stringify(value)) as JsonValue;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return { type: "object", additionalProperties: true };
  }
  return { ...parsed, type: "object" };
}

function normalizeRequiredText(
  value: string,
  label: string,
  maxLength: number,
): string {
  const normalized = normalizeText(value, maxLength);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeProcessValue(
  value: string,
  label: string,
  maxLength: number,
  allowEmpty = false,
): string {
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(`${label} is required`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must not contain control characters`);
  }
  return normalized.slice(0, maxLength);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
