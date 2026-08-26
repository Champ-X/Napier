import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  CapabilityDescriptor,
  ToolDefinitionV2,
} from "@napier/contracts/tool-protocol";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  createOwnedToolRecordV2,
  ToolProtocolRegistry,
} from "./tool-protocol-registry.js";

export const CAPABILITY_TOOL_NAME = "capability";
const CAPABILITY_ROOT_URI = "cap://tools";
const MAX_CAPABILITY_MATCHES = 20;
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
  registry?: ToolProtocolRegistry,
): AgentTool<typeof capabilitySchema, CapabilityCatalogDetails> {
  const descriptors = createCapabilityDescriptors(candidates, registry);
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
  registry?: ToolProtocolRegistry,
): CapabilityDescriptor[] {
  const expected = new Set<string>();
  for (const tool of candidates) {
    if (expected.has(tool.name)) {
      throw new Error(`Capability Catalog tool name is duplicated: ${tool.name}`);
    }
    if (tool.name !== CAPABILITY_TOOL_NAME) expected.add(tool.name);
  }
  const descriptors = (registry ?? new ToolProtocolRegistry(candidates))
    .descriptors()
    .filter(({ toolId }) => expected.has(toolId));
  if (descriptors.length !== expected.size) {
    throw new Error("Capability Catalog registry does not own every candidate");
  }
  return descriptors;
}

export function createToolDefinitionV2(tool: AgentTool): ToolDefinitionV2 {
  return createOwnedToolRecordV2(tool).definition;
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
