import type { JsonValue } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { RunConvergenceToolProgress } from "./run-convergence-tool-progress.js";
import { scopedFailureBinding } from "./run-failure-circuit-binding.js";
import {
  DEFAULT_RUN_FAILURE_CIRCUIT_POLICY,
  type ParsedRunFailure,
  type RunFailureCircuitPolicy,
  type RunFailureCircuitProjectionOptions,
  type RunFailureCircuitScope,
} from "./run-failure-circuit-model.js";
import type {
  ToolFailureClass,
  ToolFailureSemantics,
} from "./tool-failure-semantics.js";

const FAILURE_CLASSES = new Set<ToolFailureClass>([
  "invalid_input",
  "unavailable",
  "unsupported",
  "unauthorized",
  "forbidden",
  "not_found",
  "rate_limited",
  "timeout",
  "network",
  "session_state",
  "cancelled",
  "policy",
  "resource_limit",
  "unknown",
]);

const FAILURE_SCOPES = new Set<RunFailureCircuitScope>([
  "invocation",
  "target",
  "origin",
  "route",
  "capability",
  "session",
]);

const FAILURE_DISPOSITIONS = new Set<ToolFailureSemantics["disposition"]>([
  "correct_input",
  "alternate_route",
  "retry_after",
  "recover_state",
  "terminal",
]);

export function parseRunToolFailure(
  value: JsonValue | undefined,
  payload: Record<string, JsonValue> | undefined,
): ParsedRunFailure | undefined {
  const candidate = circuitRecord(value);
  if (!candidate) return undefined;
  const failureClass = candidate["class"];
  const scope = candidate["scope"];
  const disposition = candidate["disposition"];
  const fatalToSession = candidate["fatalToSession"];
  const diagnosticSha256 = candidate["diagnosticSha256"];
  const typed = candidate["kind"] !== undefined;
  if (!validFailureFields(candidate)) {
    return typed ? malformedTypedFailure(candidate) : undefined;
  }
  if (typed && !validTypedFailureFields(candidate)) {
    return malformedTypedFailure(candidate);
  }
  if (
    typed &&
    candidate["coverage"] === "trusted_declared" &&
    candidate["failureDefinitionSha256"] !==
      expectedFailureDefinitionSha256(payload)
  ) {
    return malformedTypedFailure(candidate);
  }
  const retryAfterMs = typed
    ? firstDuration(candidate["retryAfterMs"])
    : firstDuration(
        candidate["retryAfterMs"],
        payload?.["retryAfterMs"],
        circuitRecord(payload?.["details"])?.["retryAfterMs"],
      );
  const bindingSha256 = isCircuitHash(candidate["bindingSha256"])
    ? candidate["bindingSha256"]
    : undefined;
  const coverage = typedCoverage(candidate["coverage"]);
  return {
    class: failureClass as ToolFailureClass,
    scope: scope as RunFailureCircuitScope,
    disposition: disposition as ToolFailureSemantics["disposition"],
    fatalToSession: fatalToSession as boolean,
    diagnosticSha256: diagnosticSha256 as string,
    ...(bindingSha256 ? { bindingSha256 } : {}),
    ...(coverage ? { coverage } : {}),
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

function validTypedFailureFields(
  candidate: Record<string, JsonValue>,
): boolean {
  const coverage = typedCoverage(candidate["coverage"]);
  return (
    candidate["kind"] === "napier.tool-failure-semantics" &&
    candidate["schemaVersion"] === 1 &&
    coverage !== undefined &&
    isCircuitHash(candidate["failureDefinitionSha256"]) &&
    (candidate["scope"] === "invocation" ||
      coverage !== "trusted_declared" ||
      isCircuitHash(candidate["bindingSha256"])) &&
    (candidate["bindingSha256"] === undefined ||
      isCircuitHash(candidate["bindingSha256"])) &&
    (candidate["classificationErrorSha256"] === undefined ||
      isCircuitHash(candidate["classificationErrorSha256"])) &&
    (coverage !== "trusted_declared" ||
      (typeof candidate["modeId"] === "string" &&
        /^[a-z][a-z0-9_.-]{0,63}$/u.test(candidate["modeId"]))) &&
    (coverage !== "invalid_declared" ||
      (candidate["class"] === "unknown" &&
        candidate["scope"] === "invocation" &&
        candidate["disposition"] === "terminal" &&
        candidate["fatalToSession"] === false &&
        isCircuitHash(candidate["classificationErrorSha256"])))
  );
}

function typedCoverage(
  value: JsonValue | undefined,
): ParsedRunFailure["coverage"] | undefined {
  return value === "trusted_declared" ||
    value === "legacy_fallback" ||
    value === "invalid_declared"
    ? value
    : undefined;
}

function malformedTypedFailure(
  candidate: Record<string, JsonValue>,
): ParsedRunFailure {
  return {
    class: "unknown",
    scope: "invocation",
    disposition: "terminal",
    fatalToSession: false,
    diagnosticSha256: isCircuitHash(candidate["diagnosticSha256"])
      ? candidate["diagnosticSha256"]
      : sha256(canonicalJson(candidate)),
    coverage: "invalid_declared",
  };
}

function validFailureFields(candidate: Record<string, JsonValue>): boolean {
  const failureClass = candidate["class"];
  const scope = candidate["scope"];
  const disposition = candidate["disposition"];
  return (
    typeof failureClass === "string" &&
    FAILURE_CLASSES.has(failureClass as ToolFailureClass) &&
    typeof scope === "string" &&
    isRunFailureCircuitScope(scope) &&
    typeof disposition === "string" &&
    FAILURE_DISPOSITIONS.has(
      disposition as ToolFailureSemantics["disposition"],
    ) &&
    typeof candidate["fatalToSession"] === "boolean" &&
    (!candidate["fatalToSession"] || scope === "session") &&
    isCircuitHash(candidate["diagnosticSha256"])
  );
}

export function failureBinding(
  scope: RunFailureCircuitScope,
  progress: RunConvergenceToolProgress,
  callId: string | undefined,
  receiptBindingSha256?: string,
): string | undefined {
  return scopedFailureBinding(scope, progress, callId, receiptBindingSha256);
}

function expectedFailureDefinitionSha256(
  payload: Record<string, JsonValue> | undefined,
): string | undefined {
  const direct = payload?.["failureDefinitionSha256"];
  if (isCircuitHash(direct)) return direct;
  const protocol = circuitRecord(payload?.["toolProtocol"]);
  const fromProtocol = protocol?.["failureDefinitionSha256"];
  return isCircuitHash(fromProtocol) ? fromProtocol : undefined;
}

export function openingThreshold(
  failure: ParsedRunFailure,
  policy: RunFailureCircuitPolicy,
): number {
  if (
    failure.disposition === "retry_after" ||
    failure.disposition === "recover_state" ||
    failure.disposition === "terminal"
  ) {
    return 1;
  }
  return policy.thresholds[failure.scope];
}

export function halfOpenDelay(
  failure: ParsedRunFailure,
  policy: RunFailureCircuitPolicy,
): number | undefined {
  if (failure.disposition === "retry_after") {
    return clampDuration(
      failure.retryAfterMs ?? policy.defaultRetryAfterMs,
      policy.maxRetryAfterMs,
    );
  }
  if (
    failure.disposition === "alternate_route" &&
    (failure.class === "timeout" || failure.class === "network")
  ) {
    return clampDuration(
      policy.transientHalfOpenAfterMs,
      policy.maxRetryAfterMs,
    );
  }
  return undefined;
}

export function failureCircuitPolicy(
  override: RunFailureCircuitProjectionOptions["policy"],
): RunFailureCircuitPolicy {
  const defaults = DEFAULT_RUN_FAILURE_CIRCUIT_POLICY;
  return {
    schemaVersion: 1,
    failureWindowEventSpan: positiveInteger(
      override?.failureWindowEventSpan,
      defaults.failureWindowEventSpan,
    ),
    successDecay: nonnegativeInteger(
      override?.successDecay,
      defaults.successDecay,
    ),
    defaultRetryAfterMs: nonnegativeInteger(
      override?.defaultRetryAfterMs,
      defaults.defaultRetryAfterMs,
    ),
    transientHalfOpenAfterMs: nonnegativeInteger(
      override?.transientHalfOpenAfterMs,
      defaults.transientHalfOpenAfterMs,
    ),
    maxRetryAfterMs: positiveInteger(
      override?.maxRetryAfterMs,
      defaults.maxRetryAfterMs,
    ),
    thresholds: Object.fromEntries(
      [...FAILURE_SCOPES].map((scope) => [
        scope,
        positiveInteger(
          override?.thresholds?.[scope],
          defaults.thresholds[scope],
        ),
      ]),
    ) as Record<RunFailureCircuitScope, number>,
    epochEventTypes:
      override?.epochEventTypes?.filter(
        (eventType): eventType is string =>
          typeof eventType === "string" && eventType.length > 0,
      ) ?? defaults.epochEventTypes,
  };
}

export function isRunFailureCircuitScope(
  value: unknown,
): value is RunFailureCircuitScope {
  return (
    typeof value === "string" &&
    FAILURE_SCOPES.has(value as RunFailureCircuitScope)
  );
}

export function circuitRecord(
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

export function circuitText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function isCircuitHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function circuitTimestamp(value: number | string): number | undefined {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function optionalNonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function firstDuration(
  ...values: Array<JsonValue | undefined>
): number | undefined {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/u.test(value)
          ? Number(value)
          : undefined;
    if (parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function clampDuration(value: number, maximum: number): number {
  return Math.min(maximum, Math.max(0, Math.trunc(value)));
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function nonnegativeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback;
}
