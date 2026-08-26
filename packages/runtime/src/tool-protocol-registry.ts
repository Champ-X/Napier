import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  CapabilityDescriptor,
  ToolApprovalPolicyV2,
  ToolCompatibilityAdapterV2,
  ToolConcurrency,
  ToolDefinitionV2,
  ToolIdempotencyPolicyV2,
  ToolInvocationProtocolV2,
  ToolSideEffect,
  ToolUiProjectionV2,
} from "@napier/contracts/tool-protocol";

import { builtInToolEffect } from "./agent-tool-effects.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toolDefinitionSha256 } from "./tool-invocation-capsule.js";
import {
  assertToolProtocolSchema,
  genericToolResultSchema,
  jsonSchema,
  nativeToolProfile,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";

const CAPABILITY_ROOT_URI = "cap://tools";
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const REVERSIBLE_TOOL_NAMES = new Set([
  "apply_patch",
  "workspace_file_apply",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "web_fetch_save",
]);
const EXCLUSIVE_TOOL_NAMES = new Set(["workspace_file_apply"]);

export interface OwnedToolRecordV2 {
  readonly tool: AgentTool;
  readonly definition: ToolDefinitionV2;
  readonly definitionSha256: string;
  readonly implementationSha256: string;
  invocation(input: unknown): ToolInvocationProtocolV2;
  uiProjection(
    status: ToolUiProjectionV2["status"],
    input: unknown,
  ): ToolUiProjectionV2;
  validateCanonicalResult(
    result: AgentToolResult<unknown>,
    isError?: boolean,
  ): void;
  validateModelVisibleResult(
    result: AgentToolResult<unknown>,
    isError?: boolean,
  ): void;
}

export class ToolProtocolRegistry {
  private readonly records = new Map<string, OwnedToolRecordV2>();

  constructor(tools: readonly AgentTool[]) {
    for (const tool of tools) {
      if (this.records.has(tool.name)) {
        throw new Error(`Tool Protocol tool ID is duplicated: ${tool.name}`);
      }
      this.records.set(tool.name, createOwnedToolRecordV2(tool));
    }
  }

  get(toolId: string): OwnedToolRecordV2 | undefined {
    return this.records.get(toolId);
  }

  require(toolId: string): OwnedToolRecordV2 {
    const record = this.records.get(toolId);
    if (!record)
      throw new Error(`Tool Protocol definition is unavailable: ${toolId}`);
    return record;
  }

  descriptors(): CapabilityDescriptor[] {
    return [...this.records.values()]
      .filter(({ tool }) => tool.name !== "capability")
      .map(({ tool, definition, definitionSha256 }) =>
        Object.freeze({
          kind: "napier.capability-descriptor" as const,
          schemaVersion: 1 as const,
          uri: definition.capabilityUris[0]!,
          toolId: definition.id,
          label: tool.label,
          description: tool.description,
          definition,
          definitionSha256,
        }),
      )
      .sort((left, right) => left.toolId.localeCompare(right.toolId));
  }

  matchesDefinitionSha256(toolId: string, expected: string): boolean {
    const record = this.records.get(toolId);
    return Boolean(
      record &&
      (record.definitionSha256 === expected ||
        record.definition.compatibility.legacyDefinitionSha256 === expected),
    );
  }
}

export function createOwnedToolRecordV2(tool: AgentTool): OwnedToolRecordV2 {
  const implementationSha256 = toolDefinitionSha256(tool);
  const native = nativeToolProfile(tool.name);
  const compatibility: ToolCompatibilityAdapterV2 = Object.freeze({
    mode: native ? "native" : "compatibility",
    runtime: "pi-agent-tool/v1",
    legacyDefinitionSha256: implementationSha256,
  });
  const definitionInput: ToolDefinitionV2 = {
    schemaVersion: 2 as const,
    id: tool.name,
    version: native?.version ?? "1.0.0-compat.1",
    capabilityUris: [`${CAPABILITY_ROOT_URI}/${encodeURIComponent(tool.name)}`],
    inputSchema: jsonSchema(tool.parameters),
    canonicalOutputSchema:
      native?.canonicalOutputSchema ?? genericToolResultSchema("canonical"),
    modelVisibleOutputSchema:
      native?.modelVisibleOutputSchema ??
      genericToolResultSchema("model_visible"),
    uiProjectionSchema:
      native?.uiProjectionSchema ?? toolUiProjectionSchema(tool.name),
    concurrency:
      native?.concurrency ?? toolConcurrency(tool, toolSideEffect(tool.name)),
    sideEffect: native?.sideEffect ?? toolSideEffect(tool.name),
    sideEffectMode:
      native?.sideEffectMode ??
      (inputDependentEffect(tool.name) ? "input_dependent" : "static"),
    retry: native?.retry ?? { strategy: "not_started", maxAttempts: 2 },
    idempotency: native?.idempotency ?? compatibilityIdempotency(tool.name),
    approval: native?.approval ?? compatibilityApproval(tool.name),
    policyTags: native?.policyTags ?? [
      "configured",
      "compatibility:pi-agent-tool-v1",
    ],
    compatibility,
  };
  const definition = validateToolDefinitionV2(Object.freeze(definitionInput));
  const definitionSha256 = toolProtocolDefinitionSha256(definition);
  const invocation = (input: unknown): ToolInvocationProtocolV2 => {
    const sideEffect = effectiveSideEffect(definition, input);
    const approval = effectiveApproval(definition, sideEffect);
    return Object.freeze({
      kind: "napier.tool-invocation-protocol" as const,
      schemaVersion: 2 as const,
      toolId: definition.id,
      semanticVersion: definition.version,
      definitionSha256,
      implementationSha256,
      sideEffect,
      concurrency: definition.concurrency,
      retry: definition.retry,
      idempotency: definition.idempotency,
      approval,
      policyTags: definition.policyTags,
      compatibilityMode: definition.compatibility.mode,
    });
  };
  return Object.freeze({
    tool,
    definition,
    definitionSha256,
    implementationSha256,
    invocation,
    uiProjection: (status: ToolUiProjectionV2["status"], input: unknown) => {
      const current = invocation(input);
      return Object.freeze({
        kind: "napier.tool-ui-projection" as const,
        schemaVersion: 2 as const,
        toolId: current.toolId,
        semanticVersion: current.semanticVersion,
        definitionSha256: current.definitionSha256,
        implementationSha256: current.implementationSha256,
        status,
        sideEffect: current.sideEffect,
        concurrency: current.concurrency,
        compatibilityMode: current.compatibilityMode,
      });
    },
    validateCanonicalResult: (
      result: AgentToolResult<unknown>,
      isError = false,
    ) =>
      assertToolProtocolSchema(
        isError
          ? genericToolResultSchema("canonical")
          : definition.canonicalOutputSchema,
        result,
        `Tool ${tool.name} canonical result`,
      ),
    validateModelVisibleResult: (
      result: AgentToolResult<unknown>,
      isError = false,
    ) =>
      assertToolProtocolSchema(
        isError
          ? genericToolResultSchema("model_visible")
          : definition.modelVisibleOutputSchema,
        result,
        `Tool ${tool.name} model-visible result`,
      ),
  });
}

export function validateToolDefinitionV2(
  definition: ToolDefinitionV2,
): ToolDefinitionV2 {
  if (
    definition.schemaVersion !== 2 ||
    !definition.id ||
    !SEMANTIC_VERSION.test(definition.version) ||
    definition.capabilityUris.length < 1 ||
    definition.capabilityUris.some((uri) => !uri.startsWith("cap://")) ||
    definition.retry.maxAttempts < 1 ||
    definition.retry.maxAttempts > 2 ||
    (definition.retry.strategy === "never" &&
      definition.retry.maxAttempts !== 1) ||
    definition.policyTags.length < 1 ||
    definition.policyTags.some((tag) => !tag.trim()) ||
    !/^[a-f0-9]{64}$/u.test(definition.compatibility.legacyDefinitionSha256)
  ) {
    throw new Error(`Tool Protocol definition is invalid: ${definition.id}`);
  }
  return definition;
}

export function toolProtocolDefinitionSha256(
  definition: ToolDefinitionV2,
): string {
  const { legacyDefinitionSha256: _legacyDefinitionSha256, ...adapter } =
    definition.compatibility;
  return sha256(
    canonicalJson({
      ...definition,
      compatibility: adapter,
    }),
  );
}

function effectiveSideEffect(
  definition: ToolDefinitionV2,
  input: unknown,
): ToolSideEffect {
  if (definition.sideEffectMode === "static") return definition.sideEffect;
  const effect = builtInToolEffect(definition.id, input);
  if (effect === "read") return "none";
  if (effect === "write" && REVERSIBLE_TOOL_NAMES.has(definition.id)) {
    return "reversible";
  }
  return "unknown";
}

function toolSideEffect(toolName: string): ToolSideEffect {
  const effect = builtInToolEffect(toolName);
  if (effect === "read") return "none";
  if (effect === "write" && REVERSIBLE_TOOL_NAMES.has(toolName)) {
    return "reversible";
  }
  return "unknown";
}

function effectiveApproval(
  definition: ToolDefinitionV2,
  sideEffect: ToolSideEffect,
): ToolApprovalPolicyV2 {
  if (definition.sideEffectMode === "static") return definition.approval;
  return sideEffect === "none"
    ? { mode: "policy", codeBridge: "allowed" }
    : definition.approval;
}

function toolConcurrency(
  tool: AgentTool,
  sideEffect: ToolSideEffect,
): ToolConcurrency {
  if (EXCLUSIVE_TOOL_NAMES.has(tool.name)) return "exclusive";
  if (tool.executionMode === "sequential") return "serialized";
  return sideEffect === "none" ? "safe" : "serialized";
}

function inputDependentEffect(toolName: string): boolean {
  return (
    toolName === "browser" ||
    toolName === "node_debugger" ||
    toolName === "workspace_process"
  );
}

function compatibilityIdempotency(toolName: string): ToolIdempotencyPolicyV2 {
  return {
    key: toolSideEffect(toolName) === "none" ? "arguments" : "none",
    resultReplay: "never",
  };
}

function compatibilityApproval(toolName: string): ToolApprovalPolicyV2 {
  const sideEffect = toolSideEffect(toolName);
  return {
    mode: sideEffect === "none" ? "none" : "policy",
    codeBridge:
      sideEffect === "none" || sideEffect === "reversible"
        ? "allowed"
        : "external_checkpoint",
  };
}
