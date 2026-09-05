import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonObject, JsonValue } from "@napier/contracts";
import type {
  ToolFailureClassV1,
  ToolFailureDefinitionV1,
  ToolFailureModeV1,
  ToolFailureReceiptV1,
  ToolFailureSemanticsV1,
} from "@napier/contracts/tool-protocol";
import type { TSchema } from "typebox";

import { registerAgentToolMetadataTransfer } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import {
  legacyToolFailureDefinition,
  legacyToolFailureLedgerProjection,
  legacyToolFailureReceipt,
} from "./tool-failure-legacy-fallback.js";
import {
  failureDiagnosticSha256,
  failureRecord,
  failureText,
  stableFailureBindingSha256,
} from "./tool-failure-receipt-support.js";
import {
  isToolFailureReceiptV1,
  normalizeToolFailureReceipt,
} from "./tool-failure-receipt-validation.js";
import {
  TOOL_FAILURE_CLASSES as FAILURE_CLASSES,
  TOOL_FAILURE_DISPOSITIONS as FAILURE_DISPOSITIONS,
  TOOL_FAILURE_SCOPES as FAILURE_SCOPES,
} from "./tool-failure-vocabulary.js";

export { isToolFailureReceiptV1, normalizeToolFailureReceipt };

export type ToolFailureClass = ToolFailureClassV1;
export type ToolFailureSemantics = Omit<
  ToolFailureSemanticsV1,
  "kind" | "schemaVersion"
> & { diagnosticSha256: string };

export interface ToolFailureResolution {
  semantics: ToolFailureSemanticsV1;
  /** Caller-private semantic identity; only its SHA-256 enters the receipt. */
  bindingKey?: unknown;
  retryAfterMs?: number;
}

export interface ToolFailureDeclaration {
  schemaVersion: 1;
  /** Explicit semantic ABI; bump when resolver behavior changes. */
  classificationVersion: string;
  modes: readonly ToolFailureModeV1[];
  resolve(input: unknown, failure: unknown): ToolFailureResolution;
}

export interface ToolFailureSignalV1 {
  kind: "napier.tool-failure-signal";
  schemaVersion: 1;
  modeId: string;
  bindingKey?: unknown;
  retryAfterMs?: number;
}

/** A typed error carrier whose message is diagnostic-only, never semantic. */
export class ToolFailureError extends Error {
  readonly signal: ToolFailureSignalV1;

  constructor(
    message: string,
    signal: Omit<ToolFailureSignalV1, "kind" | "schemaVersion">,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolFailureError";
    this.signal = Object.freeze({
      kind: "napier.tool-failure-signal",
      schemaVersion: 1,
      ...signal,
    });
  }
}

const declarations = new WeakMap<AgentTool, ToolFailureDeclaration>();

registerAgentToolMetadataTransfer((source, target) => {
  const declaration = declarations.get(source);
  if (!declaration) return;
  const existing = declarations.get(target);
  if (existing && existing !== declaration) {
    throw new Error("Agent tool failure metadata conflicts with its source");
  }
  declarations.set(target, declaration);
});

/** Binds one versioned, tool-owned failure resolver to an AgentTool. */
export function defineToolFailureSemantics<
  TParameters extends TSchema,
  TDetails,
>(
  tool: AgentTool<TParameters, TDetails>,
  declaration: ToolFailureDeclaration,
): AgentTool<TParameters, TDetails> {
  validateDeclaration(declaration);
  const normalized: ToolFailureDeclaration = Object.freeze({
    schemaVersion: 1,
    classificationVersion: declaration.classificationVersion,
    modes: Object.freeze(
      declaration.modes.map((mode) => Object.freeze({ ...mode })),
    ),
    resolve: declaration.resolve,
  });
  declarations.set(tool, normalized);
  return tool;
}

export function toolFailureDefinition(
  tool: AgentTool,
): ToolFailureDefinitionV1 {
  const declaration = declarations.get(tool);
  if (!declaration) return legacyToolFailureDefinition();
  return toolFailureDefinitionForDeclaration(declaration);
}

export function toolFailureDefinitionForDeclaration(
  declaration: ToolFailureDeclaration,
): ToolFailureDefinitionV1 {
  validateDeclaration(declaration);
  return Object.freeze({
    kind: "napier.tool-failure-definition" as const,
    schemaVersion: 1 as const,
    availability: "declared" as const,
    coverage: "trusted_declared" as const,
    modes: declaration.modes.map((mode) => ({ ...mode })),
    resolutionSha256: failureResolutionSha256(declaration),
  });
}

export function toolFailureDefinitionSha256(
  definition: ToolFailureDefinitionV1,
): string {
  return sha256(canonicalJson(definition as unknown as JsonValue));
}

export function resolveToolFailure(
  tool: AgentTool,
  input: unknown,
  failure: unknown,
): ToolFailureReceiptV1 {
  const declaration = declarations.get(tool);
  if (!declaration) return legacyToolFailureReceipt(failure);
  return resolveDeclaredToolFailure(declaration, input, failure);
}

/** Resolves child-operation evidence with the same signed tool declaration. */
export function resolveDeclaredToolFailure(
  declaration: ToolFailureDeclaration,
  input: unknown,
  failure: unknown,
): ToolFailureReceiptV1 {
  const definition = toolFailureDefinitionForDeclaration(declaration);
  try {
    const resolution = declaration.resolve(input, failure);
    const mode = resolveDeclaredMode(declaration, resolution.semantics);
    const bindingSha256 = stableFailureBindingSha256(resolution.bindingKey);
    if (mode.scope !== "invocation" && !bindingSha256) {
      throw new Error("Declared failure omitted its scoped binding");
    }
    if (
      resolution.retryAfterMs !== undefined &&
      (!Number.isSafeInteger(resolution.retryAfterMs) ||
        resolution.retryAfterMs < 0)
    ) {
      throw new Error("Declared failure retryAfterMs is invalid");
    }
    return Object.freeze({
      ...resolution.semantics,
      coverage: "trusted_declared" as const,
      modeId: mode.modeId,
      failureDefinitionSha256: toolFailureDefinitionSha256(definition),
      ...(bindingSha256 ? { bindingSha256 } : {}),
      ...(resolution.retryAfterMs !== undefined
        ? { retryAfterMs: resolution.retryAfterMs }
        : {}),
      diagnosticSha256: failureDiagnosticSha256(failure),
    });
  } catch (error) {
    return invalidDeclaredFailureReceipt(definition, failure, error);
  }
}

export function toolFailureSignal(
  value: unknown,
): ToolFailureSignalV1 | undefined {
  return value instanceof ToolFailureError ? value.signal : undefined;
}

export function toolFailureSemantics(
  mode: Omit<ToolFailureModeV1, "modeId"> | ToolFailureModeV1,
): ToolFailureSemanticsV1 {
  const { modeId: _modeId, ...semantics } = mode as ToolFailureModeV1;
  return Object.freeze({
    kind: "napier.tool-failure-semantics" as const,
    schemaVersion: 1 as const,
    ...semantics,
  });
}

export function declaredFailureMode(
  declaration: ToolFailureDeclaration,
  modeId: string,
): ToolFailureModeV1 {
  const mode = declaration.modes.find(
    (candidate) => candidate.modeId === modeId,
  );
  if (!mode) throw new Error(`Tool failure mode is undeclared: ${modeId}`);
  return mode;
}

/**
 * Compatibility-only projection for legacy tools which have no declared
 * resolver. New tools must use `defineToolFailureSemantics`; callers must not
 * treat diagnostic text as authoritative semantics.
 */
export function toolFailureLedgerProjection(
  output: string,
  details: unknown,
): { toolFailure: JsonObject } {
  return legacyToolFailureLedgerProjection(output, details);
}

export function policyToolFailureLedgerProjection(reason: string): {
  toolFailure: JsonObject;
} {
  const semantics: ToolFailureSemantics = {
    class: "policy",
    scope: "invocation",
    disposition: "terminal",
    fatalToSession: false,
    diagnosticSha256: sha256(reason),
  };
  return { toolFailure: semantics as unknown as JsonObject };
}

/**
 * Transport libraries also use AbortError for their own deadlines and socket
 * teardown. That is not user cancellation unless the caller's signal proves
 * it. Normalize it before a declared resolver consumes the structured name.
 */
export function normalizeTransportAbortFailure(
  error: unknown,
  callerSignal: Pick<AbortSignal, "aborted">,
): unknown {
  if (!isAbortError(error) || callerSignal.aborted) return error;
  const normalized = new Error("Transport timed out before completing", {
    cause: error,
  });
  normalized.name = "TimeoutError";
  return normalized;
}

/** Structured transport classification: names/codes only, never messages. */
export function structuredTransportFailureClass(
  error: unknown,
): "cancelled" | "timeout" | "network" | undefined {
  const value = failureRecord(error);
  const name = failureText(value?.["name"]);
  const code = failureText(value?.["code"]).toUpperCase();
  if (name === "AbortError") return "cancelled";
  if (name === "TimeoutError" || code === "ETIMEDOUT") return "timeout";
  if (
    [
      "EAI_AGAIN",
      "ECONNABORTED",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETDOWN",
      "ENETUNREACH",
      "ENOTFOUND",
      "EPIPE",
    ].includes(code) ||
    code.startsWith("UND_ERR_")
  ) {
    return "network";
  }
  return undefined;
}

export { failureDiagnosticSha256 };

function failureResolutionSha256(declaration: ToolFailureDeclaration): string {
  return sha256(
    canonicalJson({
      classificationVersion: declaration.classificationVersion,
      modes: declaration.modes,
      resolveSha256: sha256(
        Function.prototype.toString.call(declaration.resolve),
      ),
    }),
  );
}

function invalidDeclaredFailureReceipt(
  definition: ToolFailureDefinitionV1,
  failure: unknown,
  classificationError: unknown,
): ToolFailureReceiptV1 {
  return Object.freeze({
    kind: "napier.tool-failure-semantics" as const,
    schemaVersion: 1 as const,
    coverage: "invalid_declared" as const,
    class: "unknown" as const,
    scope: "invocation" as const,
    disposition: "terminal" as const,
    fatalToSession: false,
    failureDefinitionSha256: toolFailureDefinitionSha256(definition),
    diagnosticSha256: failureDiagnosticSha256(failure),
    classificationErrorSha256: failureDiagnosticSha256(classificationError),
  });
}

function validateDeclaration(declaration: ToolFailureDeclaration): void {
  if (
    declaration.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+$/u.test(declaration.classificationVersion) ||
    declaration.modes.length < 1 ||
    new Set(declaration.modes.map((mode) => mode.modeId)).size !==
      declaration.modes.length ||
    declaration.modes.some(
      (mode) =>
        !/^[a-z][a-z0-9_.-]{0,63}$/u.test(mode.modeId) ||
        !FAILURE_CLASSES.has(mode.class) ||
        !FAILURE_SCOPES.has(mode.scope) ||
        !FAILURE_DISPOSITIONS.has(mode.disposition) ||
        typeof mode.fatalToSession !== "boolean" ||
        (mode.fatalToSession && mode.scope !== "session"),
    )
  ) {
    throw new Error("Tool failure declaration is invalid");
  }
}

function resolveDeclaredMode(
  declaration: ToolFailureDeclaration,
  semantics: ToolFailureSemanticsV1,
): ToolFailureModeV1 {
  if (
    semantics.kind !== "napier.tool-failure-semantics" ||
    semantics.schemaVersion !== 1 ||
    !FAILURE_CLASSES.has(semantics.class) ||
    !FAILURE_SCOPES.has(semantics.scope) ||
    !FAILURE_DISPOSITIONS.has(semantics.disposition) ||
    typeof semantics.fatalToSession !== "boolean"
  ) {
    throw new Error("Tool failure resolution is invalid");
  }
  const mode = declaration.modes.find(
    (candidate) =>
      candidate.class === semantics.class &&
      candidate.scope === semantics.scope &&
      candidate.disposition === semantics.disposition &&
      candidate.fatalToSession === semantics.fatalToSession,
  );
  if (!mode) throw new Error("Tool failure resolution mode is undeclared");
  return mode;
}

function isAbortError(error: unknown): boolean {
  return failureRecord(error)?.["name"] === "AbortError";
}
