import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  CapabilityDescriptor,
  ToolConcurrency,
  ToolDefinitionV2,
  ToolSideEffect,
} from "@napier/contracts/tool-protocol";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { builtInToolEffect } from "./agent-tool-effects.js";
import { toolDefinitionSha256 } from "./tool-invocation-capsule.js";

export const CAPABILITY_TOOL_NAME = "capability";
const CAPABILITY_ROOT_URI = "cap://tools";
const MAX_CAPABILITY_MATCHES = 20;
const REVERSIBLE_TOOL_NAMES = new Set([
  "apply_patch",
  "workspace_file_apply",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "web_fetch_save",
]);
const EXCLUSIVE_TOOL_NAMES = new Set(["workspace_file_apply"]);

const capabilitySchema = Type.Union([
  Type.Object(
    {
      uri: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      query: Type.String({ minLength: 1, maxLength: 200 }),
      limit: Type.Optional(
        Type.Integer({ minimum: 1, maximum: MAX_CAPABILITY_MATCHES }),
      ),
    },
    { additionalProperties: false },
  ),
]);
Object.assign(capabilitySchema, { type: "object" });

export interface CapabilityCatalogDetails {
  kind: "napier.capability-catalog-result";
  schemaVersion: 1;
  query: string;
  matchedCount: number;
  descriptors: CapabilityDescriptor[];
  catalogSha256: string;
}

export function createCapabilityCatalogTool(
  candidates: readonly AgentTool[],
): AgentTool<typeof capabilitySchema, CapabilityCatalogDetails> {
  const descriptors = createCapabilityDescriptors(candidates);
  const catalogSha256 = sha256(
    canonicalJson(descriptors.map(({ definitionSha256 }) => definitionSha256)),
  );
  return {
    name: CAPABILITY_TOOL_NAME,
    label: "Capability catalog",
    description:
      "Discover configured first-party and approved extension tools by query or cap://tools URI. Discovery is read-only and is not authorization; matched tool schemas become visible on the next step and still pass normal policy, approval, sandbox, receipt, and ledger gates.",
    parameters: capabilitySchema,
    execute: async (_toolCallId, input) => {
      const query = "uri" in input ? input.uri : input.query;
      const matched = "uri" in input
        ? selectByUri(descriptors, input.uri)
        : selectByQuery(descriptors, input.query, input.limit ?? 8);
      const details: CapabilityCatalogDetails = {
        kind: "napier.capability-catalog-result",
        schemaVersion: 1,
        query,
        matchedCount: matched.length,
        descriptors: matched,
        catalogSha256,
      };
      return {
        content: [{ type: "text", text: formatCapabilityResult(details) }],
        details,
        ...(matched.length > 0
          ? { addedToolNames: matched.map(({ toolId }) => toolId) }
          : {}),
      };
    },
  };
}

export function createCapabilityDescriptors(
  candidates: readonly AgentTool[],
): CapabilityDescriptor[] {
  const names = new Set<string>();
  return candidates
    .filter((tool) => tool.name !== CAPABILITY_TOOL_NAME)
    .map((tool) => {
      if (names.has(tool.name)) {
        throw new Error(`Capability Catalog tool name is duplicated: ${tool.name}`);
      }
      names.add(tool.name);
      const definition = createToolDefinitionV2(tool);
      const uri = definition.capabilityUris[0]!;
      return Object.freeze({
        kind: "napier.capability-descriptor" as const,
        schemaVersion: 1 as const,
        uri,
        toolId: tool.name,
        label: tool.label,
        description: tool.description,
        definition,
        definitionSha256: sha256(canonicalJson(definition)),
      });
    })
    .sort((left, right) => left.toolId.localeCompare(right.toolId));
}

export function createToolDefinitionV2(tool: AgentTool): ToolDefinitionV2 {
  const uri = `${CAPABILITY_ROOT_URI}/${encodeURIComponent(tool.name)}`;
  const sideEffect = toolSideEffect(tool.name);
  return Object.freeze({
    id: tool.name,
    version: toolDefinitionSha256(tool),
    capabilityUris: [uri],
    inputSchema: jsonSchema(tool.parameters),
    canonicalOutputSchema: resultSchema("canonical"),
    modelVisibleOutputSchema: resultSchema("model_visible"),
    concurrency: toolConcurrency(tool, sideEffect),
    sideEffect,
    policyTags: ["configured", `side_effect:${sideEffect}`],
  });
}

function selectByUri(
  descriptors: readonly CapabilityDescriptor[],
  uri: string,
): CapabilityDescriptor[] {
  if (uri === CAPABILITY_ROOT_URI) {
    return descriptors.slice(0, MAX_CAPABILITY_MATCHES);
  }
  return descriptors.filter((descriptor) => descriptor.uri === uri);
}

function selectByQuery(
  descriptors: readonly CapabilityDescriptor[],
  query: string,
  limit: number,
): CapabilityDescriptor[] {
  const terms = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return descriptors
    .filter((descriptor) => {
      const searchable = [
        descriptor.toolId,
        descriptor.label,
        descriptor.description,
        ...descriptor.definition.capabilityUris,
        ...descriptor.definition.policyTags,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, limit);
}

export function toolSideEffect(toolName: string): ToolSideEffect {
  const effect = builtInToolEffect(toolName);
  if (effect === "read") return "none";
  if (effect === "write" && REVERSIBLE_TOOL_NAMES.has(toolName))
    return "reversible";
  return "unknown";
}

function toolConcurrency(
  tool: AgentTool,
  sideEffect: ToolSideEffect,
): ToolConcurrency {
  if (EXCLUSIVE_TOOL_NAMES.has(tool.name)) return "exclusive";
  if (tool.executionMode === "sequential") return "serialized";
  return sideEffect === "none" ? "safe" : "serialized";
}

function jsonSchema(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function resultSchema(surface: "canonical" | "model_visible") {
  return {
    type: "object",
    required: ["content", "details"],
    properties: {
      content: { type: "array" },
      details: {},
    },
    additionalProperties: true,
    "x-napier-surface": surface,
  };
}

function formatCapabilityResult(details: CapabilityCatalogDetails): string {
  if (details.descriptors.length === 0) {
    return `No configured capability matched ${JSON.stringify(details.query)}.`;
  }
  return [
    "Configured capabilities (discovery does not grant authorization):",
    ...details.descriptors.map(
      ({ uri, toolId, label, definition }) =>
        `- ${uri} -> ${toolId} (${label}); sideEffect=${definition.sideEffect}; concurrency=${definition.concurrency}`,
    ),
  ].join("\n");
}
