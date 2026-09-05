import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";

import {
  canReconcileCapturedToolExecutionResult,
  claimDurableToolExecution,
  permitsCapturedToolExecutionResultReplay,
  reconcileCapturedToolExecutionResult,
  ToolExecutionClaimError,
  type CapturedToolExecutionResult,
  type DurableToolExecutionClaimInput,
  type DurableToolExecutionLease,
} from "./durable-tool-execution.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import { claimRunHeadEvent } from "./event-idempotency.js";
import type { AppendEventInput } from "./run-event-registry.js";
import { toolExecutionResultEffectSha256 } from "./tool-execution-result-effect.js";
import { ToolConcurrencyGate } from "./tool-concurrency-gate.js";
import { toolConcurrencyOperation } from "./tool-concurrency-operation.js";
import {
  assessToolExecutionRetryLineage,
  bindToolExecutionRetryLineage,
  ToolExecutionRetryLineageError,
  toolExecutionRetryLineagePayload,
  type BoundToolExecutionRetryLineage,
  type PriorToolExecutionAttempt,
  type ToolExecutionRetryLineage,
  type ToolExecutionRetryLineageDecision,
} from "./tool-execution-retry-lineage.js";
import type { ToolOperationJournalOptions } from "./tool-operation-model.js";

export { ToolExecutionRetryLineageError } from "./tool-execution-retry-lineage.js";

export interface ToolExecutionSettlement {
  readonly result: AgentToolResult<unknown>;
  readonly isError: boolean;
}

export interface ToolExecutionAdmissionReplay<T> {
  load(): Promise<CapturedToolExecutionResult | undefined>;
  restore(captured: CapturedToolExecutionResult): Promise<T> | T;
}

export interface ExecuteAdmittedToolCallInput<T> {
  readonly store: DurableToolExecutionClaimInput["store"];
  readonly run: Pick<RunRecord, "id" | "threadId">;
  readonly callId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly protocol: DurableToolExecutionClaimInput["protocol"];
  readonly concurrencyGate: ToolConcurrencyGate;
  readonly startedPayload: Record<string, JsonValue>;
  readonly signal?: AbortSignal;
  readonly journalOptions?: ToolOperationJournalOptions;
  readonly admissionPayload?: Record<string, JsonValue>;
  readonly admissionVisibility?: "debug" | "user";
  readonly onEvent?: EventSink;
  readonly replay?: ToolExecutionAdmissionReplay<T>;
  /**
   * Stable logical work shared by transparent retries which may use a new Run
   * or call ID. The lineage is hashed and never persisted in raw form.
   */
  readonly retryLineage?: ToolExecutionRetryLineage;
  readonly retryLineageReplay?: (
    prior: PriorToolExecutionAttempt,
  ) => Promise<{ value: T } | undefined> | { value: T } | undefined;
  onAuthorized?(): Promise<void>;
  onStarted?(): Promise<void> | void;
  execute(): Promise<T>;
  settlement(
    value: T,
  ): Promise<ToolExecutionSettlement> | ToolExecutionSettlement;
  failureSettlement?(
    error: unknown,
  ): Promise<ToolExecutionSettlement | undefined>;
}

export interface AdmittedToolCallOutcome<T> {
  readonly value: T;
  readonly replayed: boolean;
}

/**
 * The single authority path for every raw tool invocation.
 *
 * Callers may perform policy and schema checks before entering this service,
 * but they cannot acquire resources, start execution, cross an effect boundary
 * or durably settle a result anywhere else. Keeping those transitions together
 * makes newly added execution surfaces inherit the same at-most-once and
 * terminal-fencing guarantees by construction.
 */
export async function executeAdmittedToolCall<T>(
  input: ExecuteAdmittedToolCallInput<T>,
): Promise<AdmittedToolCallOutcome<T>> {
  const invocation = input.protocol.invocation(input.args);
  const retryLineage = input.retryLineage
    ? bindToolExecutionRetryLineage(input.retryLineage, invocation, input.args)
    : undefined;
  const concurrency = toolConcurrencyOperation(input.callId, invocation);
  return input.concurrencyGate.run(
    retryLineage
      ? {
          ...concurrency,
          requirements: [
            ...concurrency.requirements,
            {
              key: ["execution_retry_lineage", retryLineage.lineageSha256],
              mode: "serialized",
            },
          ],
        }
      : concurrency,
    input.signal,
    async () => {
      if (retryLineage) {
        const replay = await admitRetryLineage(input, retryLineage);
        if (replay) return replay;
      }
      return executeWithAuthority(
        input,
        retryLineage,
        invocation.sideEffect !== "none",
      );
    },
  );
}

async function executeWithAuthority<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  retryLineage?: BoundToolExecutionRetryLineage,
  crossesEffectBoundary = true,
): Promise<AdmittedToolCallOutcome<T>> {
  const claimInput = durableClaimInput(input, retryLineage);
  const recovered = await tryAvailableCapturedReplay(input, claimInput);
  if (recovered) return recovered;
  let lease: DurableToolExecutionLease;
  try {
    lease = await claimDurableToolExecution(claimInput);
  } catch (error) {
    const replay = await tryReconcileReplay(input, claimInput, error);
    if (replay) return replay;
    throw error;
  }

  try {
    await input.onAuthorized?.();
    input.protocol.assertCurrentIdentity();
    await lease.start(input.startedPayload);
    await input.onStarted?.();
    if (crossesEffectBoundary) await lease.effectBoundary();
    let value: T;
    try {
      input.protocol.assertCurrentIdentity();
      value = await input.execute();
    } catch (error) {
      await settleExecutionFailure(input, lease, error);
      throw error;
    }
    const settlement = await input.settlement(value);
    await lease.settleResult(settlement.result, settlement.isError);
    return { value, replayed: false };
  } catch (error) {
    await failLeaseOrAggregate(lease, error);
    throw error;
  }
}

function durableClaimInput<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  retryLineage?: BoundToolExecutionRetryLineage,
): DurableToolExecutionClaimInput {
  const admissionPayload =
    input.admissionPayload || retryLineage
      ? {
          ...input.admissionPayload,
          ...(retryLineage
            ? {
                executionRetryLineage: toolExecutionRetryLineagePayload(
                  retryLineage,
                ) as JsonValue,
              }
            : {}),
        }
      : undefined;
  return {
    store: input.store,
    run: input.run,
    callId: input.callId,
    toolName: input.toolName,
    args: input.args,
    protocol: input.protocol,
    ...(admissionPayload ? { admissionPayload } : {}),
    ...(input.admissionVisibility
      ? { admissionVisibility: input.admissionVisibility }
      : {}),
    ...(input.journalOptions ? { journalOptions: input.journalOptions } : {}),
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
  };
}

async function admitRetryLineage<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  binding: BoundToolExecutionRetryLineage,
): Promise<AdmittedToolCallOutcome<T> | undefined> {
  const events = await lineageEvents(input);
  const decision = assessToolExecutionRetryLineage(
    events,
    binding,
    input.run.id,
    input.callId,
  );
  if (decision.disposition === "execute") return undefined;
  if (decision.disposition === "replay" && input.retryLineageReplay) {
    const restored = await input.retryLineageReplay(decision.prior);
    if (
      restored &&
      (await matchesPriorTerminalEffect(input, decision.prior, restored.value))
    ) {
      await appendRetryLineageReplay(input, binding, decision.prior);
      return { value: restored.value, replayed: true };
    }
  }
  const rejected =
    decision.disposition === "reject"
      ? decision
      : ({
          disposition: "reject",
          reason:
            input.retryLineageReplay === undefined
              ? "prior_terminal_requires_replay"
              : "replay_evidence_mismatch",
          prior: decision.prior,
        } as const);
  const error = new ToolExecutionRetryLineageError(
    binding.lineageSha256,
    rejected.reason,
    rejected.prior,
  );
  await appendRetryLineageBlocked(input, binding, rejected, error);
  throw error;
}

async function matchesPriorTerminalEffect<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  prior: PriorToolExecutionAttempt,
  value: T,
): Promise<boolean> {
  if (!prior.effectSha256 || prior.outcome !== "succeeded") return false;
  try {
    const settlement = await input.settlement(value);
    if (settlement.isError) return false;
    return (
      toolExecutionResultEffectSha256(
        prior.callId,
        settlement.result,
        settlement.isError,
      ) === prior.effectSha256
    );
  } catch {
    return false;
  }
}

async function lineageEvents<T>(
  input: ExecuteAdmittedToolCallInput<T>,
): Promise<RunEvent[]> {
  const store = input.store as DurableToolExecutionClaimInput["store"] & {
    listEvents?: (threadId: string) => Promise<RunEvent[]>;
  };
  if (!store.listEvents) {
    throw new Error(
      "Tool execution retry lineage requires a Thread event reader",
    );
  }
  return store.listEvents(input.run.threadId);
}

async function appendRetryLineageBlocked<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  binding: BoundToolExecutionRetryLineage,
  decision: Extract<
    ToolExecutionRetryLineageDecision,
    { disposition: "reject" }
  >,
  error: ToolExecutionRetryLineageError,
): Promise<void> {
  await appendRetryLineageEvent(input, "tool.blocked", {
    callId: input.callId,
    toolName: input.toolName,
    status: "blocked",
    errorCode: error.code,
    reason: decision.reason,
    executionRetryLineage: toolExecutionRetryLineagePayload(binding),
    ...(decision.prior
      ? {
          priorRunId: decision.prior.runId,
          priorCallId: decision.prior.callId,
          priorAttempt: decision.prior.attempt,
          priorStarted: decision.prior.started,
          priorEffectBoundary: decision.prior.effectBoundary,
          ...(decision.prior.outcome
            ? { priorOutcome: decision.prior.outcome }
            : {}),
          ...(decision.prior.effectSha256
            ? { priorEffectSha256: decision.prior.effectSha256 }
            : {}),
        }
      : {}),
  });
}

async function appendRetryLineageReplay<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  binding: BoundToolExecutionRetryLineage,
  prior: PriorToolExecutionAttempt,
): Promise<void> {
  await appendRetryLineageEvent(input, "tool.result_reused", {
    schemaVersion: 1,
    sourceThreadId: input.run.threadId,
    sourceRunId: prior.runId,
    sourceCallId: prior.callId,
    targetCallId: input.callId,
    toolName: input.toolName,
    resultReused: true,
    executionRetryLineage: toolExecutionRetryLineagePayload(binding),
  });
}

async function appendRetryLineageEvent<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  type: "tool.blocked" | "tool.result_reused",
  payload: Record<string, JsonValue>,
): Promise<void> {
  const eventInput = {
    threadId: input.run.threadId,
    runId: input.run.id,
    type,
    category: "tool",
    visibility: "user",
    payload,
  } as AppendEventInput;
  const receipt = await claimRunHeadEvent(input.store, eventInput, {
    namespace: "tool-execution-retry-lineage",
    key: `${input.run.id}:${input.callId}:${type}`,
  });
  if (receipt.appended) await emitBestEffort(input.onEvent, receipt.event);
}

async function tryReconcileReplay<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  claimInput: DurableToolExecutionClaimInput,
  error: unknown,
): Promise<AdmittedToolCallOutcome<T> | undefined> {
  if (
    !(error instanceof ToolExecutionClaimError) ||
    !canReconcileCapturedToolExecutionResult(error.disposition) ||
    !permitsCapturedToolExecutionResultReplay(claimInput)
  ) {
    return undefined;
  }
  return tryCapturedReplay(input, claimInput, error.disposition);
}

async function tryAvailableCapturedReplay<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  claimInput: DurableToolExecutionClaimInput,
): Promise<AdmittedToolCallOutcome<T> | undefined> {
  if (!permitsCapturedToolExecutionResultReplay(claimInput)) return undefined;
  return tryCapturedReplay(input, claimInput, "indeterminate_replay");
}

async function tryCapturedReplay<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  claimInput: DurableToolExecutionClaimInput,
  disposition: ToolExecutionClaimError["disposition"],
): Promise<AdmittedToolCallOutcome<T> | undefined> {
  if (!input.replay) return undefined;
  const captured = await input.replay.load();
  if (
    !captured?.resultEvidenceSha256 ||
    !(await reconcileCapturedToolExecutionResult(
      claimInput,
      disposition,
      captured,
    ))
  ) {
    return undefined;
  }
  return {
    value: await input.replay.restore(captured),
    replayed: true,
  };
}

async function settleExecutionFailure<T>(
  input: ExecuteAdmittedToolCallInput<T>,
  lease: DurableToolExecutionLease,
  executionError: unknown,
): Promise<void> {
  const failure = input.protocol.failure?.(input.args, executionError);
  let settlement: ToolExecutionSettlement | undefined;
  try {
    settlement = await input.failureSettlement?.(executionError);
  } catch (settlementError) {
    await failLeaseOrAggregate(lease, settlementError, executionError);
    throw new AggregateError(
      [executionError, settlementError],
      `Tool ${input.toolName} execution and durable result settlement failed`,
      { cause: executionError },
    );
  }
  if (!settlement) {
    await failLeaseOrAggregate(lease, executionError);
    return;
  }
  try {
    await lease.settleResult(settlement.result, settlement.isError, failure);
  } catch (settlementError) {
    await failLeaseOrAggregate(lease, settlementError, executionError);
    throw new AggregateError(
      [executionError, settlementError],
      `Tool ${input.toolName} execution and durable result settlement failed`,
      { cause: executionError },
    );
  }
}

async function failLeaseOrAggregate(
  lease: DurableToolExecutionLease,
  error: unknown,
  priorError?: unknown,
): Promise<void> {
  try {
    await lease.fail(error);
  } catch (failureError) {
    throw new AggregateError(
      priorError === undefined
        ? [error, failureError]
        : [priorError, error, failureError],
      "Tool execution authority could not be durably settled",
      { cause: priorError ?? error },
    );
  }
}
