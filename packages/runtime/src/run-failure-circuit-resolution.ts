import { canonicalJson, sha256 } from "./ed25519.js";
import {
  progressFailureBinding,
  type RunConvergenceToolProgress,
} from "./run-convergence-tool-progress.js";
import {
  RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY,
  type ResolvedRunFailureCircuit,
  type RunFailureCircuitEntry,
  type RunFailureCircuitProjection,
  type RunFailureCircuitScope,
  type RunFailureCircuitStatus,
} from "./run-failure-circuit-model.js";
import { circuitTimestamp } from "./run-failure-circuit-semantics.js";

/** Resolves wall-clock TTL without introducing ambient time into projection. */
export function resolveRunFailureCircuit(
  entry: RunFailureCircuitEntry,
  asOf: number | string,
): ResolvedRunFailureCircuit {
  const asOfMs = circuitTimestamp(asOf);
  const status = resolvedStatus(entry, asOfMs);
  const retryAfterMs = remainingRetryDelay(entry, status, asOfMs);
  return {
    ...entry,
    status,
    blocks: status === "open",
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function resolvedStatus(
  entry: RunFailureCircuitEntry,
  asOfMs: number | undefined,
): RunFailureCircuitStatus {
  if (entry.openedAtSeq === undefined) return "closed";
  if (
    entry.halfOpenAtMs !== undefined &&
    asOfMs !== undefined &&
    asOfMs >= entry.halfOpenAtMs
  ) {
    return "half_open";
  }
  return "open";
}

function remainingRetryDelay(
  entry: RunFailureCircuitEntry,
  status: RunFailureCircuitStatus,
  asOfMs: number | undefined,
): number | undefined {
  return status === "open" &&
    entry.halfOpenAtMs !== undefined &&
    asOfMs !== undefined
    ? Math.max(0, entry.halfOpenAtMs - asOfMs)
    : undefined;
}

/**
 * Finds all exact circuits relevant to an invocation. A target circuit only
 * matches its resource key; it can never be promoted to an origin circuit.
 */
export function matchRunFailureCircuits(
  projection: RunFailureCircuitProjection,
  progress: Pick<
    RunConvergenceToolProgress,
    "resourceKeySha256" | "failureBindings" | "failureDomainKeySha256"
  >,
  asOf: number | string,
): ResolvedRunFailureCircuit[] {
  const entries = new Map(
    projection.entries.map((entry) => [entry.keySha256, entry] as const),
  );
  const matches = [
    ...targetMatches(entries, progressFailureBinding(progress, "target"), asOf),
    ...failureBindingMatches(entries, progress, asOf),
  ];
  return matches.sort(compareResolvedCircuits);
}

function targetMatches(
  entries: ReadonlyMap<string, RunFailureCircuitEntry>,
  resourceKeySha256: string | undefined,
  asOf: number | string,
): ResolvedRunFailureCircuit[] {
  if (!resourceKeySha256) return [];
  const target = entries.get(failureCircuitKey("target", resourceKeySha256));
  return target ? [resolveRunFailureCircuit(target, asOf)] : [];
}

function failureBindingMatches(
  entries: ReadonlyMap<string, RunFailureCircuitEntry>,
  progress: Pick<
    RunConvergenceToolProgress,
    "resourceKeySha256" | "failureBindings" | "failureDomainKeySha256"
  >,
  asOf: number | string,
): ResolvedRunFailureCircuit[] {
  return (["origin", "route", "capability", "session"] as const).flatMap(
    (scope) => {
      const bindingSha256 = progressFailureBinding(progress, scope);
      if (!bindingSha256) return [];
      const entry = entries.get(failureCircuitKey(scope, bindingSha256));
      return entry ? [resolveRunFailureCircuit(entry, asOf)] : [];
    },
  );
}

function compareResolvedCircuits(
  left: ResolvedRunFailureCircuit,
  right: ResolvedRunFailureCircuit,
): number {
  if (left.blocks !== right.blocks) return left.blocks ? -1 : 1;
  return (
    RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY.indexOf(left.scope) -
    RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY.indexOf(right.scope)
  );
}

/** Returns an open blocker first, otherwise a half-open probe lease. */
export function guardRunFailureCircuit(
  projection: RunFailureCircuitProjection,
  progress: Pick<
    RunConvergenceToolProgress,
    "resourceKeySha256" | "failureBindings" | "failureDomainKeySha256"
  >,
  asOf: number | string,
): ResolvedRunFailureCircuit | undefined {
  const matches = matchRunFailureCircuits(projection, progress, asOf);
  return (
    matches.find((entry) => entry.blocks) ??
    matches.find((entry) => entry.status === "half_open")
  );
}

export function failureCircuitKey(
  scope: RunFailureCircuitScope,
  bindingSha256: string,
): string {
  return sha256(canonicalJson({ scope, bindingSha256 }));
}
