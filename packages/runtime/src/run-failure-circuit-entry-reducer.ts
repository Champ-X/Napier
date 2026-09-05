import type { RunEvent } from "@napier/contracts";

import {
  progressFailureBinding,
  type RunConvergenceToolProgress,
} from "./run-convergence-tool-progress.js";
import {
  RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY,
  type FailureStamp,
  type MutableRunFailureCircuitEntry,
  type ParsedRunFailure,
  type RunFailureCircuitEntry,
  type RunFailureCircuitPolicy,
  type RunFailureCircuitScope,
} from "./run-failure-circuit-model.js";
import { failureCircuitKey } from "./run-failure-circuit-resolution.js";
import {
  circuitTimestamp,
  halfOpenDelay,
  openingThreshold,
} from "./run-failure-circuit-semantics.js";

export function recordRunCircuitFailure(
  entries: Map<string, MutableRunFailureCircuitEntry>,
  failure: ParsedRunFailure,
  bindingSha256: string,
  event: RunEvent,
  epoch: number,
  attemptIndex: number,
  policy: RunFailureCircuitPolicy,
): void {
  const keySha256 = failureCircuitKey(failure.scope, bindingSha256);
  const entry =
    entries.get(keySha256) ??
    createEntry(keySha256, failure.scope, bindingSha256, epoch);
  const threshold = openingThreshold(failure, policy);
  const eventMs = circuitTimestamp(event.createdAt);
  const wasOpen = entry.openedAtSeq !== undefined;
  const wasHalfOpen =
    wasOpen &&
    entry.halfOpenAtMs !== undefined &&
    eventMs !== undefined &&
    eventMs >= entry.halfOpenAtMs;
  entry.failures.push({
    seq: event.seq,
    attemptIndex,
    threshold,
    sticky: failure.disposition !== "alternate_route",
  });
  updateFailureEvidence(entry, failure, event.seq, threshold);
  if (entry.failureCount >= entry.threshold) {
    reopenEntry(entry, event.seq, eventMs, wasOpen, wasHalfOpen);
    setHalfOpenTime(entry, eventMs, halfOpenDelay(failure, policy));
  }
  entries.set(keySha256, entry);
}

function updateFailureEvidence(
  entry: MutableRunFailureCircuitEntry,
  failure: ParsedRunFailure,
  seq: number,
  fallbackThreshold: number,
): void {
  entry.failureCount = entry.failures.length;
  entry.lifetimeFailureCount += 1;
  entry.threshold = effectiveThreshold(entry.failures, fallbackThreshold);
  setWindowStart(entry);
  entry.lastFailureSeq = seq;
  entry.lastFailureClass = failure.class;
  entry.lastDisposition = failure.disposition;
  entry.recoveryRequired ||= failure.disposition === "recover_state";
}

function reopenEntry(
  entry: MutableRunFailureCircuitEntry,
  seq: number,
  eventMs: number | undefined,
  wasOpen: boolean,
  wasHalfOpen: boolean,
): void {
  if (wasOpen && !wasHalfOpen) return;
  entry.openedAtSeq = seq;
  if (eventMs !== undefined) entry.openedAtMs = eventMs;
}

function setHalfOpenTime(
  entry: MutableRunFailureCircuitEntry,
  eventMs: number | undefined,
  delay: number | undefined,
): void {
  if (delay === undefined || eventMs === undefined) {
    delete entry.halfOpenAtMs;
  } else {
    entry.halfOpenAtMs = eventMs + delay;
  }
}

export function recordRunCircuitSuccess(
  entries: Map<string, MutableRunFailureCircuitEntry>,
  progress: RunConvergenceToolProgress,
  seq: number,
  epoch: number,
  policy: RunFailureCircuitPolicy,
): void {
  for (const key of progressCircuitKeys(progress)) {
    const entry = entries.get(key);
    if (!entry || entry.epoch !== epoch) continue;
    recoverOrDecay(entry, policy.successDecay);
    entry.successCount += 1;
    entry.lastSuccessSeq = seq;
    refreshEntry(entry);
  }
}

function progressCircuitKeys(progress: RunConvergenceToolProgress): string[] {
  return (["target", "origin", "route", "capability", "session"] as const)
    .flatMap((scope) => {
      const binding = progressFailureBinding(progress, scope);
      return binding ? [failureCircuitKey(scope, binding)] : [];
    })
    .filter((key, index, keys) => keys.indexOf(key) === index);
}

function recoverOrDecay(
  entry: MutableRunFailureCircuitEntry,
  successDecay: number,
): void {
  if (entry.openedAtSeq !== undefined || entry.recoveryRequired) {
    entry.failures = [];
    entry.recoveryEpoch += 1;
    entry.recoveryRequired = false;
  } else if (successDecay > 0) {
    entry.failures.splice(Math.max(0, entry.failures.length - successDecay));
  }
}

export function pruneRunCircuitEntries(
  entries: Map<string, MutableRunFailureCircuitEntry>,
  attemptIndex: number,
  windowSpan: number,
): void {
  const firstIncludedAttempt = Math.max(0, attemptIndex - windowSpan + 1);
  for (const entry of entries.values()) {
    entry.failures = entry.failures.filter(
      (failure) =>
        failure.sticky || failure.attemptIndex >= firstIncludedAttempt,
    );
    refreshEntry(entry);
  }
}

function refreshEntry(entry: MutableRunFailureCircuitEntry): void {
  entry.failureCount = entry.failures.length;
  entry.threshold = effectiveThreshold(entry.failures, Number.MAX_SAFE_INTEGER);
  setWindowStart(entry);
  if (entry.failureCount >= entry.threshold) return;
  delete entry.openedAtSeq;
  delete entry.openedAtMs;
  delete entry.halfOpenAtMs;
  if (entry.failureCount === 0) entry.recoveryRequired = false;
}

function setWindowStart(entry: MutableRunFailureCircuitEntry): void {
  const firstSeq = entry.failures[0]?.seq;
  if (firstSeq === undefined) {
    delete entry.windowStartedAtSeq;
  } else {
    entry.windowStartedAtSeq = firstSeq;
  }
}

function createEntry(
  keySha256: string,
  scope: RunFailureCircuitScope,
  bindingSha256: string,
  epoch: number,
): MutableRunFailureCircuitEntry {
  return {
    keySha256,
    scope,
    bindingSha256,
    epoch,
    threshold: Number.MAX_SAFE_INTEGER,
    failureCount: 0,
    lifetimeFailureCount: 0,
    successCount: 0,
    recoveryEpoch: 0,
    recoveryRequired: false,
    failures: [],
  };
}

export function publicRunCircuitEntry(
  entry: MutableRunFailureCircuitEntry,
): RunFailureCircuitEntry {
  const { failures: _failures, ...projection } = entry;
  return projection;
}

function effectiveThreshold(
  failures: readonly FailureStamp[],
  fallback: number,
): number {
  return failures.reduce(
    (threshold, failure) => Math.min(threshold, failure.threshold),
    fallback,
  );
}

export function compareRunCircuitEntries(
  left: RunFailureCircuitEntry,
  right: RunFailureCircuitEntry,
): number {
  return (
    RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY.indexOf(left.scope) -
      RUN_FAILURE_CIRCUIT_SCOPE_PRIORITY.indexOf(right.scope) ||
    left.bindingSha256.localeCompare(right.bindingSha256)
  );
}
