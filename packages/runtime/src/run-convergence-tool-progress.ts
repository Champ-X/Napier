import type { JsonValue } from "@napier/contracts";
import type {
  ToolFailureBindingScope,
  ToolFailureBindingsV1,
  ToolProgressContribution,
  ToolProgressAvailability,
  ToolProgressCoverage,
  ToolProgressOperation,
} from "@napier/contracts/tool-protocol";

import type { ToolProtocolRegistry } from "./tool-protocol-registry.js";

const HASH = /^[a-f0-9]{64}$/u;

export interface RunConvergenceToolProgress {
  availability: ToolProgressAvailability;
  coverage: ToolProgressCoverage;
  operation: ToolProgressOperation;
  contribution: ToolProgressContribution;
  resourceKeySha256?: string;
  failureBindings?: ToolFailureBindingsV1;
  failureDomainKeySha256?: string;
}

const FAILURE_BINDING_SCOPES = [
  "target",
  "origin",
  "route",
  "capability",
  "session",
] as const satisfies readonly ToolFailureBindingScope[];

export interface RunConvergenceToolDefinition {
  availability: ToolProgressAvailability;
  coverage: ToolProgressCoverage;
  operations: readonly ToolProgressOperation[];
  contributions: readonly ToolProgressContribution[];
}

export function invocationRunProgress(
  registry: ToolProtocolRegistry,
  toolName: string,
  args: unknown,
): RunConvergenceToolProgress | undefined {
  const receipt = registry.get(toolName)?.progress(args);
  return receipt ? normalizeProgress(receipt) : undefined;
}

export function eventRunProgress(
  payload: Record<string, JsonValue> | undefined,
): RunConvergenceToolProgress | undefined {
  const protocol = record(payload?.["toolProtocol"]);
  return normalizeProgress(protocol?.["progress"]);
}

export function runProgressDefinition(
  registry: ToolProtocolRegistry,
  toolName: string,
): RunConvergenceToolDefinition {
  return (
    registry.get(toolName)?.definition.progress ?? {
      availability: "unavailable",
      coverage: "opaque",
      operations: ["neutral"],
      contributions: ["neutral"],
    }
  );
}

export function advancesRunDelivery(
  contribution: ToolProgressContribution,
): boolean {
  return contribution === "product" || contribution === "verification";
}

function normalizeProgress(
  value: unknown,
): RunConvergenceToolProgress | undefined {
  const candidate = unknownRecord(value);
  const operation = toolOperation(candidate?.["operation"]);
  const contribution = toolContribution(candidate?.["contribution"]);
  if (!operation || !contribution) return undefined;
  const availability =
    progressAvailability(candidate?.["availability"]) ??
    (operation === "neutral" && contribution === "neutral"
      ? "unavailable"
      : "declared");
  const coverage =
    progressCoverage(candidate?.["coverage"]) ??
    (availability === "unavailable" ? "opaque" : "trusted_declared");
  const resourceKeySha256 = hash(candidate?.["resourceKeySha256"]);
  const failureBindings = normalizeFailureBindings(
    candidate?.["failureBindings"],
  );
  const failureDomainKeySha256 = hash(candidate?.["failureDomainKeySha256"]);
  return {
    availability,
    coverage,
    operation,
    contribution,
    ...(resourceKeySha256 ? { resourceKeySha256 } : {}),
    ...(failureBindings ? { failureBindings } : {}),
    ...(failureDomainKeySha256 ? { failureDomainKeySha256 } : {}),
  };
}

/** Resolves new scope-specific evidence first and falls back to legacy v1. */
export function progressFailureBinding(
  progress: Pick<
    RunConvergenceToolProgress,
    "resourceKeySha256" | "failureBindings" | "failureDomainKeySha256"
  >,
  scope: ToolFailureBindingScope,
): string | undefined {
  return (
    progress.failureBindings?.[scope] ??
    (scope === "target"
      ? progress.resourceKeySha256
      : progress.failureDomainKeySha256)
  );
}

function normalizeFailureBindings(
  value: unknown,
): ToolFailureBindingsV1 | undefined {
  const candidate = unknownRecord(value);
  if (!candidate) return undefined;
  const bindings = Object.fromEntries(
    FAILURE_BINDING_SCOPES.flatMap((scope) => {
      const binding = hash(candidate[scope]);
      return binding ? [[scope, binding] as const] : [];
    }),
  ) as ToolFailureBindingsV1;
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function progressCoverage(value: unknown): ToolProgressCoverage | undefined {
  return value === "trusted_declared" ||
    value === "host_observed" ||
    value === "opaque"
    ? value
    : undefined;
}

function progressAvailability(
  value: unknown,
): ToolProgressAvailability | undefined {
  return value === "declared" || value === "unavailable" ? value : undefined;
}

function toolOperation(value: unknown): ToolProgressOperation | undefined {
  return value === "acquire" ||
    value === "reuse" ||
    value === "observe" ||
    value === "mutate" ||
    value === "verify" ||
    value === "coordinate" ||
    value === "neutral"
    ? value
    : undefined;
}

function toolContribution(
  value: unknown,
): ToolProgressContribution | undefined {
  return value === "supporting" ||
    value === "product" ||
    value === "verification" ||
    value === "control" ||
    value === "neutral"
    ? value
    : undefined;
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && HASH.test(value) ? value : undefined;
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
