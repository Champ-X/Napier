import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  CapabilityDescriptor,
  ToolDefinitionV2,
} from "@napier/contracts/tool-protocol";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { createOwnedToolRecordV2 } from "./owned-tool-protocol.js";
import { ToolProtocolRegistry } from "./tool-protocol-registry.js";
import {
  defineToolProgress,
  progressSemantics,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";
import { defineInternalToolProtocolV2 } from "./tool-protocol-declaration.js";
import {
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";

export const CAPABILITY_TOOL_NAME = "capability";
const CAPABILITY_ROOT_URI = "cap://tools";
const MAX_CAPABILITY_MATCHES = 20;
const CAPABILITY_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    workspace_process: [
      "bash",
      "shell",
      "posix",
      "terminal",
      "cli",
      "command line",
      "process",
      "local command",
      "npm",
    ],
    run_command: ["node", "javascript", "argv", "command"],
    web_search: ["internet", "network", "online", "web", "search"],
    web_fetch: ["internet", "network", "http", "url", "download", "fetch"],
    browser: ["website", "web page", "navigate", "click"],
    apply_patch: ["write", "edit", "modify", "patch", "source code"],
    workspace_file_apply: ["write", "edit", "create file", "artifact"],
  });
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
    canonicalJson(
      descriptors.map(({ uri, definitionSha256 }) => ({
        uri,
        definitionSha256,
      })),
    ),
  );
  const tool: AgentTool<typeof capabilitySchema, CapabilityCatalogDetails> = {
    name: CAPABILITY_TOOL_NAME,
    label: "Capability catalog",
    description:
      "Discover configured first-party and approved extension tools. Query and cap://tools only list candidates; one exact cap://tools/<tool> URI activates that tool on the next step. Discovery is read-only and is not authorization; tools still pass normal policy, approval, sandbox, receipt, and ledger gates.",
    parameters: capabilitySchema,
    execute: async (_toolCallId, input) => {
      const query = "uri" in input ? input.uri : input.query;
      const matched =
        "uri" in input
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
        ...("uri" in input &&
        input.uri !== CAPABILITY_ROOT_URI &&
        matched.length === 1
          ? { addedToolNames: [matched[0]!.toolId] }
          : {}),
      };
    },
  };
  const progressed = defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      {
        modeId: "observe_capability_catalog",
        operation: "observe",
        scope: "control",
        contribution: "supporting",
      },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("observe", "control", "supporting"),
      resourceKey: stableFields(input, ["uri", "query"]),
    }),
    state: (_input, result) =>
      stableFields(resultDetails(result), ["catalogSha256", "matchedCount"]),
  });
  return defineInternalToolProtocolV2(progressed, {
    historicalDefinitions: [
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.failure_compatibility",
        sourceMode: "compatibility",
        definitionSha256:
          "62ab9cc950ecdf11d15a5dddb1c31509d54115e7dbda1d1d11a8f35ad8472e53",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress_terminal_retry",
        sourceMode: "compatibility",
        definitionSha256:
          "e7377490300e7cb9d565f0bef63e11a3bd9f77df74c2a32c3b25847ae43714ff",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.progress_not_started_retry",
        sourceMode: "compatibility",
        definitionSha256:
          "3225e200b9d8929ce98f872e3b0de46e55a2a09679c995551dad61f18683bb1e",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress_terminal_retry",
        sourceMode: "compatibility",
        definitionSha256:
          "700f8f62dff8f67481ec36bd4956e4740c130b1082c66023fd873f5cad2b6547",
        replayOnly: true,
      },
      {
        kind: "napier.tool-protocol-historical-definition",
        schemaVersion: 1,
        generation: "v2.pre_progress",
        sourceMode: "compatibility",
        definitionSha256:
          "6df52e27c9a01bac414fb61b1bdce5db7b000258e3e986d5adbe7f7b23cb9374",
        replayOnly: true,
      },
    ],
    definition: {
      schemaVersion: 2,
      id: progressed.name,
      version: "2.0.0",
      capabilityUris: ["cap://tools/capability"],
      inputSchema: jsonSchema(progressed.parameters),
      canonicalOutputSchema: genericToolResultSchema("canonical"),
      modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
      uiProjectionSchema: toolUiProjectionSchema(progressed.name),
      concurrency: "safe",
      sideEffect: "none",
      sideEffectMode: "static",
      retry: { strategy: "terminal_failure", maxAttempts: 2 },
      idempotency: { key: "arguments", resultReplay: "exact_result_only" },
      approval: { mode: "none", codeBridge: "allowed" },
      policyTags: ["capability:discovery", "control:read"],
    },
  });
}

export function createCapabilityDescriptors(
  candidates: readonly AgentTool[],
  registry?: ToolProtocolRegistry,
): CapabilityDescriptor[] {
  const expected = new Set<string>();
  for (const tool of candidates) {
    if (expected.has(tool.name)) {
      throw new Error(
        `Capability Catalog tool name is duplicated: ${tool.name}`,
      );
    }
    if (tool.name !== CAPABILITY_TOOL_NAME) expected.add(tool.name);
  }
  const descriptors = (registry ?? new ToolProtocolRegistry(candidates))
    .descriptors()
    .filter(({ toolId }) => expected.has(toolId));
  const describedToolIds = new Set(
    descriptors.map((descriptor) => descriptor.toolId),
  );
  if (
    describedToolIds.size !== expected.size ||
    [...expected].some((toolId) => !describedToolIds.has(toolId))
  ) {
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
        ...capabilitySearchAliases(descriptor.toolId),
        ...descriptor.definition.capabilityUris,
        ...descriptor.definition.policyTags,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return terms.every((term) => searchable.includes(term));
    })
    .slice(0, limit);
}

function capabilitySearchAliases(toolId: string): readonly string[] {
  return toolId.startsWith("git_")
    ? ["git", "repository", "repo", "version control", "local source"]
    : (CAPABILITY_SEARCH_ALIASES[toolId] ?? []);
}

function formatCapabilityResult(details: CapabilityCatalogDetails): string {
  if (details.descriptors.length === 0) {
    return `No configured capability matched ${JSON.stringify(details.query)}.`;
  }
  return [
    "Configured capabilities (discovery does not grant authorization; call one exact URI to activate it):",
    ...details.descriptors.map(
      ({ uri, toolId, label, definition }) =>
        `- ${uri} -> ${toolId} (${label}); sideEffect=${definition.sideEffect}; concurrency=${definition.concurrency}`,
    ),
  ].join("\n");
}
