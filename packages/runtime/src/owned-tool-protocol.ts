import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ToolApprovalPolicyV2,
  ToolCompatibilityAdapterV2,
  ToolConcurrency,
  ToolDefinitionV2,
  ToolFailureReceiptV1,
  ToolIdempotencyPolicyV2,
  ToolInvocationProtocolV2,
  ToolProgressReceiptV1,
  ToolSideEffect,
  ToolUiProjectionV2,
} from "@napier/contracts/tool-protocol";

import {
  agentToolCompatibilityPolicy,
  builtInToolCompatibilityPolicy,
  trustedAgentToolCompatibilityPolicy,
} from "./agent-tool-effects.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toolDefinitionSha256 } from "./tool-invocation-capsule.js";
import { isValidToolDefinitionV2 } from "./tool-protocol-definition-validation.js";
import {
  resolveToolFailure,
  toolFailureDefinition,
  toolFailureDefinitionSha256,
} from "./tool-failure-semantics.js";
import {
  resolveToolProgress,
  toolProgressDefinition,
} from "./tool-progress-semantics.js";
import {
  assertToolProtocolSchema,
  genericToolResultSchema,
  jsonSchema,
  toolUiProjectionSchema,
} from "./tool-protocol-schema.js";
import {
  assertInternalToolProtocolAttestation,
  assertToolProtocolDeclarationMatchesTool,
  copyToolProtocolDeclarationV2,
  hasInternalToolProtocolAttestation,
  resolveDeclaredToolSideEffect,
  toolProtocolDeclarationV2,
  type ToolProtocolDeclarationV2,
} from "./tool-protocol-declaration.js";

const CAPABILITY_ROOT_URI = "cap://tools";
/** One tool whose signed protocol ownership has already been established. */
export interface OwnedToolRecordV2 {
  readonly tool: AgentTool;
  readonly definition: ToolDefinitionV2;
  readonly definitionSha256: string;
  readonly implementationSha256: string;
  readonly historicalDefinitionSha256s: readonly string[];
  readonly legacyImplementationSha256s: readonly string[];
  matchesDefinitionSha256(expected: string): boolean;
  matchesReplayIdentitySha256(expected: string): boolean;
  assertCurrentIdentity(): void;
  invocation(input: unknown): ToolInvocationProtocolV2;
  progress(
    input: unknown,
    result?: AgentToolResult<unknown>,
    isError?: boolean,
  ): ToolProgressReceiptV1;
  /** Resolves durable failure evidence from the original execution failure. */
  failure(input: unknown, failure: unknown): ToolFailureReceiptV1;
  uiProjection(
    status: ToolUiProjectionV2["status"],
    input: unknown,
    result?: AgentToolResult<unknown>,
    isError?: boolean,
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

/** Owns, validates and content-addresses one raw AgentTool protocol ABI. */
export function createOwnedToolRecordV2(tool: AgentTool): OwnedToolRecordV2 {
  const implementationSha256 = toolDefinitionSha256(tool);
  const declared = toolProtocolDeclarationV2(tool);
  if (declared) {
    copyToolProtocolDeclarationV2(tool, tool);
    assertToolProtocolDeclarationMatchesTool(tool, declared);
  }
  const hostAttested = declared
    ? hasInternalToolProtocolAttestation(tool)
    : false;
  const compatibilityPolicy = hostAttested
    ? trustedAgentToolCompatibilityPolicy(tool)
    : agentToolCompatibilityPolicy(tool);
  const nativeCompatibility: ToolCompatibilityAdapterV2 = Object.freeze({
    mode: hostAttested ? "native" : "compatibility",
    runtime: "pi-agent-tool/v1",
    legacyDefinitionSha256: implementationSha256,
  });
  const compatibilityDefinition = validateToolDefinitionV2(
    deepFreezeJson(
      compatibilityToolDefinition(
        tool,
        compatibilityPolicy,
        Object.freeze({
          ...nativeCompatibility,
          mode: "compatibility" as const,
        }),
      ),
    ) as ToolDefinitionV2,
  );
  const definitionInput: ToolDefinitionV2 =
    hostAttested && declared
      ? { ...declared.definition, compatibility: nativeCompatibility }
      : compatibilityDefinition;
  // Tool definitions are a signed ABI. Deep-clone/freeze every nested schema
  // and policy so callers cannot mutate behavior after definitionSha256 is
  // published.
  const definition = validateToolDefinitionV2(
    deepFreezeJson(definitionInput) as ToolDefinitionV2,
  );
  const definitionSha256 = toolProtocolDefinitionSha256(definition);
  const failureDefinitionSha256 = toolFailureDefinitionSha256(
    definition.failure,
  );
  const historicalDefinitionSha256s = Object.freeze([
    ...new Set([
      ...(hostAttested && declared
        ? declared.historicalDefinitions.map(
            (historical) => historical.definitionSha256,
          )
        : []),
    ]),
  ]);
  const legacyImplementationSha256s = Object.freeze([
    definition.compatibility.legacyDefinitionSha256,
  ]);
  const assertCurrentIdentity = (): void => {
    if (toolDefinitionSha256(tool) !== implementationSha256) {
      throw new Error(
        `Tool Protocol implementation changed after ownership: ${tool.name}`,
      );
    }
    if (declared) assertToolProtocolDeclarationMatchesTool(tool, declared);
    if (hostAttested) assertInternalToolProtocolAttestation(tool);
  };
  const invocation = (input: unknown): ToolInvocationProtocolV2 => {
    assertCurrentIdentity();
    const trustedDeclaration = hostAttested ? declared : undefined;
    const sideEffect = effectiveSideEffect(
      definition,
      trustedDeclaration,
      input,
    );
    const approval = effectiveApproval(definition, sideEffect);
    return Object.freeze({
      kind: "napier.tool-invocation-protocol" as const,
      schemaVersion: 2 as const,
      toolId: definition.id,
      semanticVersion: definition.version,
      definitionSha256,
      failureDefinitionSha256,
      implementationSha256,
      sideEffect,
      concurrency: definition.concurrency,
      retry: definition.retry,
      idempotency: definition.idempotency,
      approval,
      progress: resolveToolProgress(tool, input),
      policyTags: definition.policyTags,
      compatibilityMode: definition.compatibility.mode,
    });
  };
  return Object.freeze({
    tool,
    definition,
    definitionSha256,
    implementationSha256,
    historicalDefinitionSha256s,
    legacyImplementationSha256s,
    matchesDefinitionSha256: (expected: string) =>
      definitionSha256 === expected,
    matchesReplayIdentitySha256: (expected: string) =>
      definitionSha256 === expected ||
      historicalDefinitionSha256s.includes(expected) ||
      legacyImplementationSha256s.includes(expected),
    assertCurrentIdentity,
    invocation,
    progress: (
      input: unknown,
      result?: AgentToolResult<unknown>,
      isError?: boolean,
    ) => resolveToolProgress(tool, input, result, isError),
    failure: (input: unknown, failure: unknown) =>
      resolveToolFailure(tool, input, failure),
    uiProjection: (
      status: ToolUiProjectionV2["status"],
      input: unknown,
      result?: AgentToolResult<unknown>,
      isError?: boolean,
    ) => {
      const current = invocation(input);
      return Object.freeze({
        kind: "napier.tool-ui-projection" as const,
        schemaVersion: 2 as const,
        toolId: current.toolId,
        semanticVersion: current.semanticVersion,
        definitionSha256: current.definitionSha256,
        failureDefinitionSha256: current.failureDefinitionSha256,
        implementationSha256: current.implementationSha256,
        status,
        sideEffect: current.sideEffect,
        concurrency: current.concurrency,
        progress: resolveToolProgress(tool, input, result, isError),
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
  if (!isValidToolDefinitionV2(definition)) {
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

function deepFreezeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeJson(item)));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, deepFreezeJson(item)]),
      ),
    );
  }
  return value;
}

function effectiveSideEffect(
  definition: ToolDefinitionV2,
  declaration: ToolProtocolDeclarationV2 | undefined,
  input: unknown,
): ToolSideEffect {
  if (definition.sideEffectMode === "static") return definition.sideEffect;
  if (declaration) return resolveDeclaredToolSideEffect(declaration, input);
  return builtInToolCompatibilityPolicy(definition.id, input).sideEffect;
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

function compatibilityConcurrency(
  tool: AgentTool,
  policy: ReturnType<typeof agentToolCompatibilityPolicy>,
): ToolConcurrency {
  // Neither an execution-mode hint nor a legacy name may weaken an unknown
  // effect boundary. Only a declared, host-attested protocol can do that.
  if (policy.sideEffect === "unknown") return "exclusive";
  if (policy.concurrency) return policy.concurrency;
  if (tool.executionMode === "sequential") return "serialized";
  if (policy.sideEffect === "none") return "safe";
  return "serialized";
}

function compatibilityIdempotency(
  sideEffect: ToolSideEffect,
): ToolIdempotencyPolicyV2 {
  return {
    key: sideEffect === "none" ? "arguments" : "none",
    resultReplay: "never",
  };
}

function compatibilityApproval(
  sideEffect: ToolSideEffect,
): ToolApprovalPolicyV2 {
  return {
    mode: sideEffect === "none" ? "none" : "policy",
    codeBridge:
      sideEffect === "none" || sideEffect === "reversible"
        ? "allowed"
        : "external_checkpoint",
  };
}

function compatibilityToolDefinition(
  tool: AgentTool,
  policy: ReturnType<typeof agentToolCompatibilityPolicy>,
  compatibility: ToolCompatibilityAdapterV2,
): ToolDefinitionV2 {
  const sideEffect = policy.sideEffect;
  return {
    schemaVersion: 2,
    id: tool.name,
    version: "1.0.0-compat.1",
    capabilityUris: [`${CAPABILITY_ROOT_URI}/${encodeURIComponent(tool.name)}`],
    inputSchema: jsonSchema(tool.parameters),
    canonicalOutputSchema: genericToolResultSchema("canonical"),
    modelVisibleOutputSchema: genericToolResultSchema("model_visible"),
    uiProjectionSchema: toolUiProjectionSchema(tool.name),
    concurrency: compatibilityConcurrency(tool, policy),
    sideEffect,
    sideEffectMode: policy.sideEffectMode,
    retry: policy.retry,
    idempotency: compatibilityIdempotency(sideEffect),
    approval: compatibilityApproval(sideEffect),
    progress: toolProgressDefinition(tool),
    failure: toolFailureDefinition(tool),
    policyTags: ["configured", "compatibility:pi-agent-tool-v1"],
    compatibility,
  };
}
