import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ToolProgressContribution,
  ToolProgressDefinitionV1,
  ToolFailureBindingScope,
  ToolFailureBindingsV1,
  ToolProgressModeV1,
  ToolProgressOperation,
  ToolProgressReceiptV1,
  ToolProgressScope,
  ToolProgressSemanticsV1,
} from "@napier/contracts/tool-protocol";
import type { TSchema } from "typebox";

import { registerAgentToolMetadataTransfer } from "./agent-tool-metadata.js";
import { canonicalJson, sha256 } from "./ed25519.js";

const HASH = /^[a-f0-9]{64}$/u;
const OPERATIONS = new Set<ToolProgressOperation>([
  "acquire",
  "reuse",
  "observe",
  "mutate",
  "verify",
  "coordinate",
  "neutral",
]);
const SCOPES = new Set<ToolProgressScope>([
  "external",
  "run_source",
  "workspace",
  "session",
  "remote",
  "control",
  "neutral",
]);
const CONTRIBUTIONS = new Set<ToolProgressContribution>([
  "supporting",
  "product",
  "verification",
  "control",
  "neutral",
]);

export interface ToolProgressResolution {
  semantics: ToolProgressSemanticsV1;
  /** A canonical, private binding. Only its SHA-256 leaves the Registry. */
  resourceKey?: unknown;
  /** Independent semantic bindings for each failure-circuit scope. */
  failureBindings?: Partial<Record<ToolFailureBindingScope, unknown>>;
  /** A broader retry/circuit domain, such as a public origin or provider. */
  failureDomainKey?: unknown;
}

export interface ToolProgressDeclaration {
  schemaVersion: 1;
  /** Explicit semantic ABI; bump when resolve/state behavior changes. */
  classificationVersion: string;
  modes: readonly ToolProgressModeV1[];
  resolve(
    input: unknown,
    result?: AgentToolResult<unknown>,
  ): ToolProgressResolution;
  /** Return only stable state. Volatile timestamps/counters must be omitted. */
  state?(input: unknown, result: AgentToolResult<unknown>): unknown | undefined;
}

const declarations = new WeakMap<AgentTool, ToolProgressDeclaration>();

registerAgentToolMetadataTransfer((source, target) => {
  const declaration = declarations.get(source);
  if (!declaration) return;
  const existing = declarations.get(target);
  if (existing && existing !== declaration) {
    throw new Error("Agent tool progress metadata conflicts with its source");
  }
  declarations.set(target, declaration);
});

export function defineToolProgress<TParameters extends TSchema, TDetails>(
  tool: AgentTool<TParameters, TDetails>,
  declaration: ToolProgressDeclaration,
): AgentTool<TParameters, TDetails> {
  validateDeclaration(declaration);
  // The Registry definition and every runtime receipt must be derived from
  // the exact same immutable declaration. Keeping caller-owned array
  // references here would let a receipt drift away from the definition hash.
  const normalized: ToolProgressDeclaration = Object.freeze({
    schemaVersion: 1,
    classificationVersion: declaration.classificationVersion,
    modes: Object.freeze(
      declaration.modes.map((mode) => Object.freeze({ ...mode })),
    ),
    resolve: declaration.resolve,
    ...(declaration.state ? { state: declaration.state } : {}),
  });
  declarations.set(tool, normalized);
  return tool;
}

export function toolProgressDefinition(
  tool: AgentTool,
): ToolProgressDefinitionV1 {
  const declaration = declarations.get(tool);
  const modes = declaration?.modes ?? [];
  return declaration
    ? Object.freeze({
        kind: "napier.tool-progress-definition" as const,
        schemaVersion: 1 as const,
        availability: "declared" as const,
        coverage: "trusted_declared" as const,
        operations: [...new Set(modes.map((mode) => mode.operation))],
        contributions: [...new Set(modes.map((mode) => mode.contribution))],
        modes: modes.map((mode) => ({ ...mode })),
        resolutionSha256: progressResolutionSha256(declaration, modes),
      })
    : neutralToolProgressDefinition();
}

function progressResolutionSha256(
  declaration: ToolProgressDeclaration,
  modes: readonly ToolProgressModeV1[],
): string {
  return sha256(
    canonicalJson({
      classificationVersion: declaration.classificationVersion,
      modes,
      // The semantic version communicates author intent; these hashes also
      // bind the executable classifiers so an omitted version bump cannot
      // silently reinterpret already durable progress evidence.
      resolveSha256: sha256(
        Function.prototype.toString.call(declaration.resolve),
      ),
      stateSha256: sha256(
        declaration.state
          ? Function.prototype.toString.call(declaration.state)
          : "",
      ),
    }),
  );
}

export function resolveToolProgress(
  tool: AgentTool,
  input: unknown,
  result?: AgentToolResult<unknown>,
  isError = false,
): ToolProgressReceiptV1 {
  const declaration = declarations.get(tool);
  if (!declaration) return neutralToolProgressReceipt();
  let resolution: ToolProgressResolution;
  let mode: ToolProgressModeV1;
  try {
    resolution = declaration.resolve(input, result);
    mode = resolveDeclaredMode(declaration, resolution.semantics);
  } catch (error) {
    return classificationFailureReceipt(declaration, error);
  }
  const resourceKeySha256 = stableBinding(resolution.resourceKey);
  const failureBindings = stableFailureBindings(resolution.failureBindings);
  const failureDomainKeySha256 = stableBinding(resolution.failureDomainKey);
  let state: unknown;
  try {
    state = !isError && result ? declaration.state?.(input, result) : undefined;
  } catch (error) {
    return Object.freeze({
      ...resolution.semantics,
      modeId: mode.modeId,
      coverage: "opaque" as const,
      contribution: "neutral" as const,
      ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
      ...(failureBindings ? { failureBindings } : {}),
      ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
      classificationErrorSha256: errorFingerprint(error),
    });
  }
  const stateSha256 = stableBinding(state);
  const incompleteBinding =
    resolution.semantics.contribution !== "neutral" &&
    (!resourceKeySha256 || (!isError && result !== undefined && !stateSha256));
  return Object.freeze({
    ...resolution.semantics,
    modeId: mode.modeId,
    ...(incompleteBinding
      ? { coverage: "opaque" as const, contribution: "neutral" as const }
      : {}),
    ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
    ...(failureBindings ? { failureBindings } : {}),
    ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
    ...(stateSha256 ? { stateSha256 } : {}),
  });
}

const FAILURE_BINDING_SCOPES = [
  "target",
  "origin",
  "route",
  "capability",
  "session",
] as const satisfies readonly ToolFailureBindingScope[];

function stableFailureBindings(
  values: ToolProgressResolution["failureBindings"],
): ToolFailureBindingsV1 | undefined {
  if (!values) return undefined;
  const bindings = Object.fromEntries(
    FAILURE_BINDING_SCOPES.flatMap((scope) => {
      const binding = stableBinding(values[scope]);
      return binding ? [[scope, binding] as const] : [];
    }),
  ) as ToolFailureBindingsV1;
  return Object.keys(bindings).length > 0 ? Object.freeze(bindings) : undefined;
}

function classificationFailureReceipt(
  declaration: ToolProgressDeclaration,
  error: unknown,
): ToolProgressReceiptV1 {
  return Object.freeze({
    kind: "napier.tool-progress-semantics" as const,
    schemaVersion: 1 as const,
    availability: "declared" as const,
    coverage: "opaque" as const,
    operation:
      new Set(declaration.modes.map((mode) => mode.operation)).size === 1
        ? declaration.modes[0]!.operation
        : ("neutral" as const),
    scope: "neutral" as const,
    // Never promote an unclassified result into product/readiness progress.
    contribution: "neutral" as const,
    classificationErrorSha256: errorFingerprint(error),
  });
}

function errorFingerprint(error: unknown): string {
  return sha256(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
}

export function progressSemantics(
  operation: ToolProgressOperation,
  scope: ToolProgressScope,
  contribution: ToolProgressContribution,
): ToolProgressSemanticsV1 {
  return Object.freeze({
    kind: "napier.tool-progress-semantics" as const,
    schemaVersion: 1 as const,
    availability: "declared" as const,
    coverage: "trusted_declared" as const,
    operation,
    scope,
    contribution,
  });
}

export function publicUrlProgressResource(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { kind: "invalid-public-url", inputSha256: sha256(value) };
    }
    url.hash = "";
    return { kind: "public-url", origin: url.origin, url: url.href };
  } catch {
    return { kind: "invalid-public-url", inputSha256: sha256(value) };
  }
}

export function publicUrlProgressFailureDomain(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { kind: "invalid-public-origin", inputSha256: sha256(value) };
    }
    return { kind: "public-origin", origin: url.origin };
  } catch {
    return { kind: "invalid-public-origin", inputSha256: sha256(value) };
  }
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resultDetails(
  result: AgentToolResult<unknown>,
): Record<string, unknown> {
  return recordValue(result.details);
}

export function stableFields(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  const source = recordValue(value);
  const entries = fields.flatMap((field) => {
    const candidate = source[field];
    return candidate === undefined ? [] : [[field, candidate] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function neutralToolProgressDefinition(): ToolProgressDefinitionV1 {
  return Object.freeze({
    kind: "napier.tool-progress-definition" as const,
    schemaVersion: 1 as const,
    // The tool exists and is executable; only its progress semantics are
    // unknown. Runtime availability and semantic coverage are independent.
    availability: "declared" as const,
    coverage: "opaque" as const,
    operations: ["neutral" as const],
    contributions: ["neutral" as const],
  });
}

function neutralToolProgressReceipt(): ToolProgressReceiptV1 {
  return Object.freeze({
    ...progressSemantics("neutral", "neutral", "neutral"),
    availability: "declared" as const,
    coverage: "opaque" as const,
  });
}

function stableBinding(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && HASH.test(value)) return value;
  try {
    return sha256(canonicalJson(normalizeJson(value)));
  } catch {
    return undefined;
  }
}

function normalizeJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function validateDeclaration(declaration: ToolProgressDeclaration): void {
  if (
    declaration.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+$/.test(declaration.classificationVersion) ||
    declaration.modes.length < 1 ||
    new Set(declaration.modes.map((mode) => mode.modeId)).size !==
      declaration.modes.length ||
    declaration.modes.some(
      (mode) =>
        !/^[a-z][a-z0-9_.-]{0,63}$/u.test(mode.modeId) ||
        !OPERATIONS.has(mode.operation) ||
        !SCOPES.has(mode.scope) ||
        !CONTRIBUTIONS.has(mode.contribution),
    )
  ) {
    throw new Error("Tool progress declaration is invalid");
  }
}

function resolveDeclaredMode(
  declaration: ToolProgressDeclaration,
  semantics: ToolProgressSemanticsV1,
): ToolProgressModeV1 {
  if (
    semantics.kind !== "napier.tool-progress-semantics" ||
    semantics.schemaVersion !== 1 ||
    semantics.availability !== "declared" ||
    semantics.coverage !== "trusted_declared" ||
    !OPERATIONS.has(semantics.operation) ||
    !SCOPES.has(semantics.scope) ||
    !CONTRIBUTIONS.has(semantics.contribution)
  ) {
    throw new Error("Tool progress resolution is invalid");
  }
  const mode = declaration.modes.find(
    (candidate) =>
      candidate.operation === semantics.operation &&
      candidate.scope === semantics.scope &&
      candidate.contribution === semantics.contribution,
  );
  if (!mode) throw new Error("Tool progress resolution mode is undeclared");
  return mode;
}
