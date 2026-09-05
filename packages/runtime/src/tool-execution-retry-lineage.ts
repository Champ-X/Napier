import type { JsonValue, RunEvent } from "@napier/contracts";
import type { ToolInvocationProtocolV2 } from "@napier/contracts/tool-protocol";

import { canonicalJson, sha256 } from "./ed25519.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";

const HASH = /^[a-f0-9]{64}$/u;
const NAMESPACE = /^[a-z][a-z0-9_.:-]{0,127}$/u;

export interface ToolExecutionRetryLineage {
  /** Stable domain chosen by the execution surface, never a display label. */
  readonly namespace: string;
  /** Stable logical work binding. Raw content is hashed before persistence. */
  readonly binding: unknown;
  /** Monotonic attempt within this logical execution lineage. */
  readonly attempt: number;
  /** Execution-surface retry budget (for example, the Workflow node policy). */
  readonly maxAttempts: number;
}

export interface BoundToolExecutionRetryLineage {
  readonly lineageSha256: string;
  readonly invocationSha256: string;
  readonly attempt: number;
  readonly retryStrategy: ToolInvocationProtocolV2["retry"]["strategy"];
  readonly toolRetryMaxAttempts: number;
  readonly lineageMaxAttempts: number;
  readonly idempotencyKey: ToolInvocationProtocolV2["idempotency"]["key"];
  readonly resultReplay: ToolInvocationProtocolV2["idempotency"]["resultReplay"];
  readonly sideEffect: ToolInvocationProtocolV2["sideEffect"];
}

export interface PriorToolExecutionAttempt {
  readonly runId: string;
  readonly callId: string;
  readonly attempt: number;
  readonly started: boolean;
  readonly effectBoundary: boolean;
  readonly outcome?: "succeeded" | "failed" | "skipped";
  readonly effectSha256?: string;
}

export type ToolExecutionRetryLineageDecision =
  | { readonly disposition: "execute" }
  | {
      readonly disposition: "replay";
      readonly prior: PriorToolExecutionAttempt;
    }
  | {
      readonly disposition: "reject";
      readonly reason:
        | "binding_conflict"
        | "missing_prior_attempt"
        | "duplicate_attempt"
        | "non_contiguous_attempt"
        | "ambiguous_prior_attempt"
        | "attempt_limit_exhausted"
        | "stale_attempt"
        | "retry_forbidden"
        | "prior_execution_started"
        | "prior_effect_indeterminate"
        | "prior_terminal_requires_replay"
        | "replay_evidence_mismatch";
      readonly prior?: PriorToolExecutionAttempt;
    };

type ToolExecutionRetrySequenceDecision =
  | ToolExecutionRetryLineageDecision
  | {
      readonly disposition: "continue";
      readonly prior: PriorToolExecutionAttempt;
    };

export class ToolExecutionRetryLineageError extends Error {
  override readonly name = "ToolExecutionRetryLineageError";
  readonly code = "TOOL_EXECUTION_RETRY_LINEAGE_REJECTED";

  constructor(
    readonly lineageSha256: string,
    readonly reason: Extract<
      ToolExecutionRetryLineageDecision,
      { disposition: "reject" }
    >["reason"],
    readonly prior?: PriorToolExecutionAttempt,
  ) {
    super(
      `Tool execution retry lineage ${lineageSha256} rejected attempt after ${reason.replaceAll("_", " ")}`,
    );
  }
}

export function bindToolExecutionRetryLineage(
  lineage: ToolExecutionRetryLineage,
  invocation: ToolInvocationProtocolV2,
  args: unknown,
): BoundToolExecutionRetryLineage {
  if (!NAMESPACE.test(lineage.namespace)) {
    throw new Error("Tool execution retry lineage namespace is invalid");
  }
  if (!Number.isSafeInteger(lineage.attempt) || lineage.attempt < 1) {
    throw new Error("Tool execution retry lineage attempt is invalid");
  }
  if (!Number.isSafeInteger(lineage.maxAttempts) || lineage.maxAttempts < 1) {
    throw new Error("Tool execution retry lineage maximum attempts is invalid");
  }
  if (
    !Number.isSafeInteger(invocation.retry.maxAttempts) ||
    invocation.retry.maxAttempts < 1 ||
    invocation.retry.maxAttempts > 2
  ) {
    throw new Error("Tool execution retry lineage maximum attempts is invalid");
  }
  const binding = stableJson(lineage.binding, "binding");
  const argumentsValue = stableJson(args, "arguments");
  const lineageSha256 = sha256(
    canonicalJson({
      kind: "napier.tool-execution-retry-lineage",
      schemaVersion: 1,
      namespace: lineage.namespace,
      binding,
    }),
  );
  const invocationSha256 = sha256(
    canonicalJson({
      kind: "napier.tool-execution-retry-invocation",
      schemaVersion: 1,
      toolId: invocation.toolId,
      definitionSha256: invocation.definitionSha256,
      implementationSha256: invocation.implementationSha256,
      retryStrategy: invocation.retry.strategy,
      toolRetryMaxAttempts: invocation.retry.maxAttempts,
      lineageMaxAttempts: lineage.maxAttempts,
      idempotencyKey: invocation.idempotency.key,
      resultReplay: invocation.idempotency.resultReplay,
      sideEffect: invocation.sideEffect,
      arguments: argumentsValue,
    }),
  );
  return {
    lineageSha256,
    invocationSha256,
    attempt: lineage.attempt,
    retryStrategy: invocation.retry.strategy,
    toolRetryMaxAttempts: invocation.retry.maxAttempts,
    lineageMaxAttempts: lineage.maxAttempts,
    idempotencyKey: invocation.idempotency.key,
    resultReplay: invocation.idempotency.resultReplay,
    sideEffect: invocation.sideEffect,
  };
}

export function toolExecutionRetryLineagePayload(
  binding: BoundToolExecutionRetryLineage,
): Record<string, JsonValue> {
  return {
    kind: "napier.tool-execution-retry-lineage",
    schemaVersion: 1,
    lineageSha256: binding.lineageSha256,
    invocationSha256: binding.invocationSha256,
    attempt: binding.attempt,
    retryStrategy: binding.retryStrategy,
    toolRetryMaxAttempts: binding.toolRetryMaxAttempts,
    lineageMaxAttempts: binding.lineageMaxAttempts,
    idempotencyKey: binding.idempotencyKey,
    resultReplay: binding.resultReplay,
    sideEffect: binding.sideEffect,
  };
}

export function assessToolExecutionRetryLineage(
  events: readonly RunEvent[],
  current: BoundToolExecutionRetryLineage,
  currentRunId: string,
  currentCallId: string,
): ToolExecutionRetryLineageDecision {
  const admissions = events.flatMap((event) => {
    if (event.type !== "tool.admitted") return [];
    const payload = record(event.payload);
    const lineage = parseLineage(payload?.["executionRetryLineage"]);
    const callId = text(payload?.["callId"]);
    if (
      !lineage ||
      lineage.lineageSha256 !== current.lineageSha256 ||
      !callId ||
      (event.runId === currentRunId && callId === currentCallId)
    ) {
      return [];
    }
    return [{ event, callId, lineage }];
  });
  const conflicting = admissions.find(
    ({ lineage }) => lineage.invocationSha256 !== current.invocationSha256,
  );
  if (conflicting) {
    return {
      disposition: "reject",
      reason: "binding_conflict",
      prior: priorAttempt(
        events,
        conflicting.event.runId,
        conflicting.callId,
        conflicting.lineage.attempt,
      ),
    };
  }
  const attempts = admissions.map(({ event, callId, lineage }) =>
    priorAttempt(events, event.runId, callId, lineage.attempt),
  );
  const sequence = assessAttemptSequence(attempts, current);
  return sequence.disposition === "continue"
    ? assessPriorAttempt(sequence.prior, current)
    : sequence;
}

function assessAttemptSequence(
  attempts: PriorToolExecutionAttempt[],
  current: BoundToolExecutionRetryLineage,
): ToolExecutionRetrySequenceDecision {
  const latest = attempts.sort(compareAttempts).at(-1);
  if (current.attempt > current.lineageMaxAttempts) {
    return {
      disposition: "reject",
      reason: "attempt_limit_exhausted",
      ...(latest ? { prior: latest } : {}),
    };
  }
  if (attempts.length === 0) {
    if (current.attempt !== 1) {
      return { disposition: "reject", reason: "missing_prior_attempt" };
    }
    return { disposition: "execute" };
  }

  // `attempts.length` proves this is present; keep the local assertion near
  // the evidence-dependent policy below so malformed attempt numbers never
  // synthesize lineage history.
  const prior = latest!;
  if (current.attempt < prior.attempt) {
    return { disposition: "reject", reason: "stale_attempt", prior };
  }
  if (current.attempt === prior.attempt) {
    return {
      disposition: "reject",
      reason: "duplicate_attempt",
      prior,
    };
  }
  if (current.attempt !== prior.attempt + 1) {
    return {
      disposition: "reject",
      reason: "non_contiguous_attempt",
      prior,
    };
  }
  if (
    attempts.filter((attempt) => attempt.attempt === prior.attempt).length !== 1
  ) {
    return {
      disposition: "reject",
      reason: "ambiguous_prior_attempt",
      prior,
    };
  }
  return { disposition: "continue", prior };
}

function assessPriorAttempt(
  prior: PriorToolExecutionAttempt,
  current: BoundToolExecutionRetryLineage,
): ToolExecutionRetryLineageDecision {
  if (prior.started || prior.effectBoundary) {
    if (
      prior.outcome === "succeeded" &&
      current.idempotencyKey !== "none" &&
      current.resultReplay === "exact_result_only"
    ) {
      return { disposition: "replay", prior };
    }
    if (
      prior.outcome === "failed" &&
      current.retryStrategy === "terminal_failure" &&
      current.sideEffect === "none"
    ) {
      return { disposition: "execute" };
    }
    if (
      !prior.outcome &&
      !prior.effectBoundary &&
      current.retryStrategy === "terminal_failure" &&
      current.sideEffect === "none"
    ) {
      return { disposition: "execute" };
    }
    return {
      disposition: "reject",
      reason:
        prior.effectBoundary && !prior.outcome
          ? "prior_effect_indeterminate"
          : prior.outcome === "succeeded"
            ? "prior_terminal_requires_replay"
            : "prior_execution_started",
      prior,
    };
  }
  return current.retryStrategy === "never"
    ? {
        disposition: "reject",
        reason: "retry_forbidden",
        prior,
      }
    : { disposition: "execute" };
}

function priorAttempt(
  events: readonly RunEvent[],
  runId: string,
  callId: string,
  attempt: number,
): PriorToolExecutionAttempt {
  const runEvents = events.filter((event) => event.runId === runId);
  const authorityIds = toolExecutionAuthorityOperationIds(runEvents);
  const authorityEvents = runEvents.filter((event) => {
    const payload = record(event.payload);
    return (
      text(payload?.["parentCallId"]) === callId &&
      authorityIds.has(text(payload?.["operationId"]) ?? "")
    );
  });
  const started =
    runEvents.some(
      (event) =>
        event.type === "tool.started" &&
        text(record(event.payload)?.["callId"]) === callId,
    ) ||
    authorityEvents.some((event) => event.type === "tool.operation.started");
  const effectBoundary = authorityEvents.some(
    (event) =>
      event.type === "tool.operation.lease.renewed" &&
      record(event.payload)?.["executionEffectBoundary"] === true,
  );
  const effectIndeterminate = authorityEvents.some(
    (event) => event.type === "tool.operation.effect_indeterminate",
  );
  const settled = effectIndeterminate
    ? undefined
    : authorityEvents
        .filter((event) => event.type === "tool.operation.settled")
        .at(-1);
  const outcome = record(settled?.payload)?.["outcome"];
  const effectSha256 = record(settled?.payload)?.["effectSha256"];
  return {
    runId,
    callId,
    attempt,
    started,
    effectBoundary,
    ...(outcome === "succeeded" || outcome === "failed" || outcome === "skipped"
      ? { outcome }
      : {}),
    ...(hash(effectSha256) ? { effectSha256 } : {}),
  };
}

function parseLineage(
  value: unknown,
): BoundToolExecutionRetryLineage | undefined {
  const candidate = record(value);
  if (!candidate || !validLineageEnvelope(candidate)) return undefined;
  const retry = lineageRetryReceipt(candidate);
  const idempotency = lineageIdempotencyReceipt(candidate);
  const sideEffect = lineageSideEffectReceipt(candidate);
  if (!retry || !idempotency || !sideEffect) return undefined;
  if (retry.strategy === "terminal_failure" && sideEffect !== "none")
    return undefined;
  return {
    lineageSha256: candidate["lineageSha256"] as string,
    invocationSha256: candidate["invocationSha256"] as string,
    attempt: Number(candidate["attempt"]),
    retryStrategy: retry.strategy,
    toolRetryMaxAttempts: retry.toolMaxAttempts,
    lineageMaxAttempts: retry.lineageMaxAttempts,
    idempotencyKey: idempotency.key,
    resultReplay: idempotency.resultReplay,
    sideEffect,
  };
}

function validLineageEnvelope(candidate: Record<string, JsonValue>): boolean {
  return (
    candidate["kind"] === "napier.tool-execution-retry-lineage" &&
    candidate["schemaVersion"] === 1 &&
    hash(candidate["lineageSha256"]) &&
    hash(candidate["invocationSha256"]) &&
    Number.isSafeInteger(candidate["attempt"]) &&
    Number(candidate["attempt"]) >= 1
  );
}

function lineageRetryReceipt(candidate: Record<string, JsonValue>):
  | {
      strategy: BoundToolExecutionRetryLineage["retryStrategy"];
      toolMaxAttempts: number;
      lineageMaxAttempts: number;
    }
  | undefined {
  const strategy = candidate["retryStrategy"];
  const toolMaxAttempts = Number(candidate["toolRetryMaxAttempts"]);
  const lineageMaxAttempts = Number(candidate["lineageMaxAttempts"]);
  if (
    (strategy !== "never" &&
      strategy !== "not_started" &&
      strategy !== "terminal_failure") ||
    !Number.isSafeInteger(candidate["toolRetryMaxAttempts"]) ||
    toolMaxAttempts < 1 ||
    toolMaxAttempts > 2 ||
    !Number.isSafeInteger(candidate["lineageMaxAttempts"]) ||
    lineageMaxAttempts < 1
  ) {
    return undefined;
  }
  return { strategy, toolMaxAttempts, lineageMaxAttempts };
}

function lineageIdempotencyReceipt(candidate: Record<string, JsonValue>):
  | {
      key: BoundToolExecutionRetryLineage["idempotencyKey"];
      resultReplay: BoundToolExecutionRetryLineage["resultReplay"];
    }
  | undefined {
  const key = candidate["idempotencyKey"];
  const resultReplay = candidate["resultReplay"];
  if (
    (key !== "none" && key !== "arguments" && key !== "preview_token") ||
    (resultReplay !== "never" && resultReplay !== "exact_result_only")
  ) {
    return undefined;
  }
  return { key, resultReplay };
}

function lineageSideEffectReceipt(
  candidate: Record<string, JsonValue>,
): BoundToolExecutionRetryLineage["sideEffect"] | undefined {
  const sideEffect = candidate["sideEffect"];
  return sideEffect === "none" ||
    sideEffect === "reversible" ||
    sideEffect === "irreversible" ||
    sideEffect === "unknown"
    ? sideEffect
    : undefined;
}

function stableJson(value: unknown, label: string): JsonValue {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error();
    return JSON.parse(encoded) as JsonValue;
  } catch {
    throw new Error(
      `Tool execution retry lineage ${label} is not serializable`,
    );
  }
}

function compareAttempts(
  left: PriorToolExecutionAttempt,
  right: PriorToolExecutionAttempt,
): number {
  return left.attempt - right.attempt || left.runId.localeCompare(right.runId);
}

function record(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}
