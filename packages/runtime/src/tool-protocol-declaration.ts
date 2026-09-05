import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import type {
  ToolDefinitionV2,
  ToolSideEffect,
} from "@napier/contracts/tool-protocol";

import {
  agentToolImplementationSha256,
  registerAgentToolMetadataTransfer,
} from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { toolFailureDefinition } from "./tool-failure-semantics.js";
import { toolProgressDefinition } from "./tool-progress-semantics.js";
import { isValidToolDefinitionV2 } from "./tool-protocol-definition-validation.js";
import { jsonSchema } from "./tool-protocol-schema.js";

const HASH_PLACEHOLDER = "0".repeat(64);
const SHA256 = /^[a-f0-9]{64}$/u;
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const HISTORY_GENERATION = /^[a-z][a-z0-9_.-]{0,63}$/u;

/**
 * Stable semantic declaration slot. Symbols are ignored by JSON and copied by
 * object spread, so this is evidence rather than execution authority. Host
 * trust transfers only through the private metadata-attestation path below.
 */
export const TOOL_PROTOCOL_DECLARATION_V2 = Symbol.for(
  "napier.agent-tool.protocol-declaration.v2",
);

export type DeclaredToolDefinitionV2 = Omit<
  ToolDefinitionV2,
  "compatibility" | "sideEffectResolutionSha256" | "progress" | "failure"
>;

export interface ToolSideEffectResolutionV1 {
  schemaVersion: 1;
  /** Bump whenever the classification meaning changes. */
  classificationVersion: string;
  /** Canonical, hash-bound policy configuration supplied to the resolver. */
  semanticIdentity: JsonValue;
  resolve(input: unknown, semanticIdentity: JsonValue): ToolSideEffect;
}

export interface ToolProtocolDeclarationInputV2 {
  /** Semantic ABI apart from host-owned compatibility and runtime bindings. */
  definition: DeclaredToolDefinitionV2;
  /** Required for input-dependent effects; forbidden for static effects. */
  sideEffectResolution?: ToolSideEffectResolutionV1;
  /** Exact hashes of already-deployed definitions; replay-only, never authority. */
  historicalDefinitions?: readonly ToolProtocolHistoricalDefinitionV1[];
}

export interface ToolProtocolHistoricalDefinitionV1 {
  kind: "napier.tool-protocol-historical-definition";
  schemaVersion: 1;
  generation: string;
  sourceMode: "native" | "compatibility";
  definitionSha256: string;
  replayOnly: true;
}

export interface ToolProtocolDeclarationV2 {
  readonly definition: Omit<ToolDefinitionV2, "compatibility">;
  readonly sideEffectResolution?: Readonly<ToolSideEffectResolutionV1>;
  readonly historicalDefinitions: readonly Readonly<ToolProtocolHistoricalDefinitionV1>[];
}

type SelfDescribingAgentTool = AgentTool & {
  [TOOL_PROTOCOL_DECLARATION_V2]?: ToolProtocolDeclarationV2;
};

interface HostToolProtocolAttestationV1 {
  readonly schemaVersion: 1;
  readonly declarationSha256: string;
  readonly implementationSha256: string;
}

// Trust never lives on the serializable/copyable declaration. Only host code
// in this package can issue and transfer this object-identity-bound witness.
const hostAttestations = new WeakMap<
  AgentTool,
  HostToolProtocolAttestationV1
>();

/** Makes one AgentTool self-describing without granting host execution trust. */
export function defineToolProtocolV2<T extends AgentTool>(
  tool: T,
  input: ToolProtocolDeclarationInputV2,
): T {
  const declaration = normalizeDeclaration(tool, input);
  const current = toolProtocolDeclarationV2(tool);
  if (current) {
    if (declarationIdentity(current) !== declarationIdentity(declaration)) {
      throw new Error(
        `Tool Protocol declaration is already bound: ${tool.name}`,
      );
    }
    hardenDeclarationSlot(tool, current);
    return tool;
  }
  hardenDeclarationSlot(tool, declaration);
  return tool;
}

/**
 * Host-only composition boundary for reviewed built-in tools. This function is
 * deliberately not re-exported from the package public API. Third-party tools
 * may self-describe with defineToolProtocolV2, but cannot gain native trust.
 */
export function defineInternalToolProtocolV2<T extends AgentTool>(
  tool: T,
  input: ToolProtocolDeclarationInputV2,
): T {
  const declared = defineToolProtocolV2(tool, input);
  attestInternalToolProtocol(declared);
  return declared;
}

export function toolProtocolDeclarationV2(
  tool: AgentTool,
): ToolProtocolDeclarationV2 | undefined {
  return (tool as SelfDescribingAgentTool)[TOOL_PROTOCOL_DECLARATION_V2];
}

/** Used by non-spread decorators and the generic AgentTool metadata copier. */
export function copyToolProtocolDeclarationV2<T extends AgentTool>(
  source: AgentTool,
  target: T,
): T {
  const declaration = toolProtocolDeclarationV2(source);
  if (!declaration) return target;
  const current = toolProtocolDeclarationV2(target);
  if (current) {
    if (declarationIdentity(current) !== declarationIdentity(declaration)) {
      throw new Error(
        `Tool Protocol decorator changed declaration ownership: ${target.name}`,
      );
    }
    hardenDeclarationSlot(target, current);
    return target;
  }
  hardenDeclarationSlot(target, declaration);
  return target;
}

registerAgentToolMetadataTransfer((source, target) => {
  copyToolProtocolDeclarationV2(source, target);
  const sourceAttestation = hostAttestations.get(source);
  if (!sourceAttestation) return;
  assertInternalToolProtocolAttestation(source);
  attestInternalToolProtocol(target);
});

export function hasInternalToolProtocolAttestation(tool: AgentTool): boolean {
  try {
    assertInternalToolProtocolAttestation(tool);
    return true;
  } catch {
    return false;
  }
}

export function assertInternalToolProtocolAttestation(tool: AgentTool): void {
  const declaration = toolProtocolDeclarationV2(tool);
  const attestation = hostAttestations.get(tool);
  if (
    !declaration ||
    !attestation ||
    attestation.schemaVersion !== 1 ||
    attestation.declarationSha256 !== declarationIdentity(declaration) ||
    attestation.implementationSha256 !== agentToolImplementationSha256(tool)
  ) {
    throw new Error(`Tool Protocol host attestation is invalid: ${tool.name}`);
  }
}

export function resolveDeclaredToolSideEffect(
  declaration: ToolProtocolDeclarationV2,
  input: unknown,
): ToolSideEffect {
  if (declaration.definition.sideEffectMode === "static") {
    return declaration.definition.sideEffect;
  }
  try {
    const resolution = declaration.sideEffectResolution;
    const sideEffect = resolution?.resolve(input, resolution.semanticIdentity);
    return isToolSideEffect(sideEffect) ? sideEffect : "unknown";
  } catch {
    // Classification uncertainty is itself an unknown effect boundary.
    return "unknown";
  }
}

function normalizeDeclaration(
  tool: AgentTool,
  input: ToolProtocolDeclarationInputV2,
): ToolProtocolDeclarationV2 {
  assertHostOwnedFieldsAbsent(input.definition);
  const effect = normalizeSideEffectResolution(
    input.definition.sideEffectMode,
    input.sideEffectResolution,
  );
  const definition = deepFreezeJson({
    ...jsonSchema(input.definition),
    progress: toolProgressDefinition(tool),
    failure: toolFailureDefinition(tool),
    ...(effect
      ? { sideEffectResolutionSha256: sideEffectResolutionSha256(effect) }
      : {}),
  }) as Omit<ToolDefinitionV2, "compatibility">;
  const historicalDefinitions = normalizeHistoricalDefinitions(
    input.historicalDefinitions ?? [],
  );
  const declaration: ToolProtocolDeclarationV2 = Object.freeze({
    definition,
    historicalDefinitions,
    ...(effect ? { sideEffectResolution: effect } : {}),
  });
  assertToolProtocolDeclarationMatchesTool(tool, declaration);
  if (
    !isValidToolDefinitionV2({
      ...definition,
      compatibility: {
        mode: "native",
        runtime: "pi-agent-tool/v1",
        legacyDefinitionSha256: HASH_PLACEHOLDER,
      },
    })
  ) {
    throw new Error(
      `Self-described Tool Protocol definition is invalid: ${tool.name}`,
    );
  }
  return declaration;
}

export function assertToolProtocolDeclarationMatchesTool(
  tool: AgentTool,
  declaration: ToolProtocolDeclarationV2,
): void {
  const { definition } = declaration;
  const effectResolution = declaration.sideEffectResolution;
  const effectBindingMatches =
    definition.sideEffectMode === "static"
      ? effectResolution === undefined &&
        definition.sideEffectResolutionSha256 === undefined
      : effectResolution !== undefined &&
        validSideEffectResolution(effectResolution) &&
        definition.sideEffectResolutionSha256 ===
          sideEffectResolutionSha256(effectResolution);
  if (
    !Object.isFrozen(declaration) ||
    !Object.isFrozen(definition) ||
    !validHistoricalDefinitions(declaration.historicalDefinitions) ||
    "compatibility" in definition ||
    !effectBindingMatches ||
    definition.schemaVersion !== 2 ||
    definition.id !== tool.name ||
    canonicalJson(definition.inputSchema) !==
      canonicalJson(jsonSchema(tool.parameters)) ||
    canonicalJson(definition.progress) !==
      canonicalJson(toolProgressDefinition(tool)) ||
    canonicalJson(definition.failure) !==
      canonicalJson(toolFailureDefinition(tool))
  ) {
    throw new Error(
      `Self-described Tool Protocol definition does not match tool: ${tool.name}`,
    );
  }
}

function assertHostOwnedFieldsAbsent(
  definition: DeclaredToolDefinitionV2,
): void {
  const value = definition as unknown as Record<string, unknown>;
  for (const field of [
    "compatibility",
    "sideEffectResolutionSha256",
    "progress",
    "failure",
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Tool Protocol field is host-owned: ${field}`);
    }
  }
}

function normalizeSideEffectResolution(
  mode: ToolDefinitionV2["sideEffectMode"],
  resolution: ToolSideEffectResolutionV1 | undefined,
): Readonly<ToolSideEffectResolutionV1> | undefined {
  if (mode === "static") {
    if (resolution) {
      throw new Error("Static Tool Protocol effects cannot declare a resolver");
    }
    return undefined;
  }
  if (!resolution || !validSideEffectResolution(resolution)) {
    throw new Error(
      "Input-dependent Tool Protocol effects require a versioned resolver",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    classificationVersion: resolution.classificationVersion,
    semanticIdentity: deepFreezeJson(resolution.semanticIdentity) as JsonValue,
    resolve: resolution.resolve,
  });
}

function validSideEffectResolution(
  resolution: ToolSideEffectResolutionV1,
): boolean {
  return (
    resolution.schemaVersion === 1 &&
    SEMANTIC_VERSION.test(resolution.classificationVersion) &&
    isJsonValue(resolution.semanticIdentity) &&
    typeof resolution.resolve === "function"
  );
}

function sideEffectResolutionSha256(
  resolution: ToolSideEffectResolutionV1,
): string {
  return sha256(
    canonicalJson({
      classificationVersion: resolution.classificationVersion,
      semanticIdentity: resolution.semanticIdentity,
      resolveSha256: sha256(
        Function.prototype.toString.call(resolution.resolve),
      ),
    }),
  );
}

function declarationIdentity(declaration: ToolProtocolDeclarationV2): string {
  return sha256(
    canonicalJson({
      definition: declaration.definition,
      historicalDefinitions: declaration.historicalDefinitions,
    }),
  );
}

function normalizeHistoricalDefinitions(
  definitions: readonly ToolProtocolHistoricalDefinitionV1[],
): readonly Readonly<ToolProtocolHistoricalDefinitionV1>[] {
  const normalized = Object.freeze(
    definitions.map((definition) => Object.freeze({ ...definition })),
  );
  if (!validHistoricalDefinitions(normalized)) {
    throw new Error("Tool Protocol historical definitions are invalid");
  }
  return normalized;
}

function validHistoricalDefinitions(
  definitions: readonly Readonly<ToolProtocolHistoricalDefinitionV1>[],
): boolean {
  return (
    Object.isFrozen(definitions) &&
    new Set(definitions.map((definition) => definition.definitionSha256))
      .size === definitions.length &&
    definitions.every(
      (definition) =>
        Object.isFrozen(definition) &&
        definition.kind === "napier.tool-protocol-historical-definition" &&
        definition.schemaVersion === 1 &&
        HISTORY_GENERATION.test(definition.generation) &&
        (definition.sourceMode === "native" ||
          definition.sourceMode === "compatibility") &&
        SHA256.test(definition.definitionSha256) &&
        definition.replayOnly === true,
    )
  );
}

function hardenDeclarationSlot(
  tool: AgentTool,
  declaration: ToolProtocolDeclarationV2,
): void {
  try {
    Object.defineProperty(tool, TOOL_PROTOCOL_DECLARATION_V2, {
      value: declaration,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  } catch {
    throw new Error(
      `Tool Protocol declaration cannot be hardened: ${tool.name}`,
    );
  }
}

function attestInternalToolProtocol(tool: AgentTool): void {
  const declaration = toolProtocolDeclarationV2(tool);
  if (!declaration) {
    throw new Error(`Tool Protocol declaration is unavailable: ${tool.name}`);
  }
  assertToolProtocolDeclarationMatchesTool(tool, declaration);
  hostAttestations.set(
    tool,
    Object.freeze({
      schemaVersion: 1 as const,
      declarationSha256: declarationIdentity(declaration),
      implementationSha256: agentToolImplementationSha256(tool),
    }),
  );
}

function isToolSideEffect(value: unknown): value is ToolSideEffect {
  return ["none", "reversible", "irreversible", "unknown"].includes(
    String(value),
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item),
    )
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
