import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { JsonValue, RunEvent, RunRecord } from "@napier/contracts";
import type {
  ToolFailureReceiptV1,
  ToolInvocationProtocolV2,
  ToolProgressReceiptV1,
  ToolUiProjectionV2,
} from "@napier/contracts/tool-protocol";

import { agentToolResultText } from "./agent-tool-result-text.js";
import { canonicalJson, sha256 } from "./ed25519.js";
import { emitBestEffort, type EventSink } from "./event-sink.js";
import {
  claimRunHeadEvent,
  IdempotentEventConflictError,
} from "./event-idempotency.js";
import type { AppendEventInput } from "./run-event-registry.js";
import {
  toolInvocationArgumentsSha256,
  validateToolInvocationCapsuleReceipt,
} from "./tool-invocation-capsule.js";
import { validateToolInvocationResultCapsuleReceipt } from "./tool-invocation-result-capsule.js";
import { toolInvocationResultSha256 } from "./tool-invocation-result-normalization.js";
import { toolExecutionResultEffect } from "./tool-execution-result-effect.js";
import {
  legacyToolExecutionAuthorityDescriptor,
  toolExecutionAuthorityDescriptor,
} from "./tool-execution-authority-binding.js";
import {
  DurableToolOperationJournal,
  ToolOperationFencingError,
} from "./tool-operation-journal.js";
import type {
  ToolOperationJournalOptions,
  ToolOperationJournalStore,
  ToolOperationLifecycle,
  ToolOperationSettlement,
  ToolOperationSettlementRepairDecision,
} from "./tool-operation-model.js";
import { createToolCallSha256 } from "./tool-loop-guard.js";

export type ToolExecutionReplayDisposition =
  | "rejected"
  | "terminal_replay"
  | "in_flight_replay"
  | "indeterminate_replay"
  | "stale_epoch_replay";

export class ToolExecutionClaimError extends Error {
  override readonly name = "ToolExecutionClaimError";

  constructor(
    readonly callId: string,
    readonly disposition: ToolExecutionReplayDisposition,
    message: string,
  ) {
    super(message);
  }
}

export function canReconcileCapturedToolExecutionResult(
  disposition: ToolExecutionReplayDisposition,
): boolean {
  // A capsule proves what one executor produced; it does not transfer that
  // executor's continuation authority. While a lease is live, returning the
  // capsule to a second caller would let both callers continue from the same
  // tool call. Indeterminate executions likewise require a fenced settlement
  // repair before their result may be delivered. Only a durable terminal is
  // immediately replayable, but is still reconciled against its terminal
  // outcome/effect before delivery.
  return (
    disposition === "terminal_replay" ||
    disposition === "indeterminate_replay" ||
    disposition === "stale_epoch_replay"
  );
}

export function permitsCapturedToolExecutionResultReplay(
  input: Pick<DurableToolExecutionClaimInput, "args" | "protocol">,
): boolean {
  return (
    input.protocol.invocation(input.args).idempotency.resultReplay ===
    "exact_result_only"
  );
}

/** Minimum signed protocol surface required by execution authority. */
export interface DurableToolExecutionProtocol {
  matchesReplayIdentitySha256(expected: string): boolean;
  assertCurrentIdentity(): void;
  validateCanonicalResult(
    result: AgentToolResult<unknown>,
    isError?: boolean,
  ): void;
  invocation(input: unknown): ToolInvocationProtocolV2;
  progress(
    input: unknown,
    result?: AgentToolResult<unknown>,
    isError?: boolean,
  ): ToolProgressReceiptV1;
  uiProjection(
    status: ToolUiProjectionV2["status"],
    input: unknown,
    result?: AgentToolResult<unknown>,
    isError?: boolean,
  ): ToolUiProjectionV2;
  /** Tool-owned classification of the original thrown value. */
  failure?(input: unknown, rawFailure: unknown): ToolFailureReceiptV1;
}

export interface DurableToolExecutionClaimInput {
  store: ToolOperationJournalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  callId: string;
  toolName: string;
  args: unknown;
  protocol: DurableToolExecutionProtocol;
  admissionPayload?: Record<string, JsonValue>;
  admissionVisibility?: "debug" | "user";
  journalOptions?: ToolOperationJournalOptions;
  onEvent?: EventSink;
}

export interface CapturedToolExecutionResult {
  result: AgentToolResult<unknown>;
  isError: boolean;
  /** Content address of the validated context.tool_result receipt. */
  resultEvidenceSha256: string;
}

/**
 * Claims at-most-once execution for one stable tool call ID.
 *
 * `tool.admitted` is the stable invocation-identity claim: its CAS key binds
 * one run/call ID to one tool definition and input. The operation journal is
 * the renewable execution authority layered on top of that immutable claim.
 * Replaying either layer can therefore never silently change the invocation
 * or grant two live execution leases.
 */
export async function claimDurableToolExecution(
  input: DurableToolExecutionClaimInput,
): Promise<DurableToolExecutionLease> {
  const invocation = input.protocol.invocation(input.args);
  const callInputSha256 = createToolCallSha256(input.toolName, input.args);
  const admissionId = sha256(
    canonicalJson({
      schemaVersion: 1,
      runId: input.run.id,
      callId: input.callId,
      toolId: input.toolName,
      definitionSha256: invocation.definitionSha256,
    }),
  );
  try {
    await appendPhase(
      input,
      "tool.admitted",
      {
        ...input.admissionPayload,
        callId: input.callId,
        toolName: input.toolName,
        status: "admitted",
        admissionId,
        callInputSha256,
        concurrency: invocation.concurrency,
        toolProtocol: input.protocol.uiProjection(
          "started",
          input.args,
        ) as unknown as JsonValue,
      },
      input.admissionVisibility ?? "debug",
      {
        // Preserve the pre-claim-refactor key as a durable alias. It is still
        // a unique run/call identity claim, and prevents upgraded processes
        // from appending a second admission for an already executed call.
        namespace: "durable-tool-execution-phase",
        key: `${input.run.id}:${input.callId}:tool.admitted`,
      },
    );
  } catch (error) {
    if (error instanceof IdempotentEventConflictError) {
      throw new ToolExecutionClaimError(
        input.callId,
        "rejected",
        `Tool call ${input.callId} replay conflicts with its durable input or definition binding`,
      );
    }
    throw error;
  }
  const operation = await executionAuthorityOperation(input, invocation);
  const decision = await operation.admit();
  if (decision.disposition !== "execute") {
    throw new ToolExecutionClaimError(
      input.callId,
      decision.disposition,
      decision.reason ??
        `Tool call ${input.callId} did not acquire durable execution authority`,
    );
  }
  if (!decision.admitted) {
    throw new ToolExecutionClaimError(
      input.callId,
      "rejected",
      `Tool call ${input.callId} received an invalid execution decision`,
    );
  }
  return new DurableToolExecutionLease(input, operation);
}

export async function repairDurableToolExecutionFromCapturedResult(
  input: DurableToolExecutionClaimInput,
  captured: CapturedToolExecutionResult,
): Promise<ToolOperationSettlementRepairDecision> {
  // Durable evidence and an execution lease establish provenance, not policy
  // permission. Mutation/preview/native profiles can deliberately forbid
  // result delivery even when an exact capsule exists; never let recovery
  // turn that evidence into an implicit result-replay grant.
  if (!permitsCapturedToolExecutionResultReplay(input)) {
    return { disposition: "not_repairable" };
  }
  const invocation = input.protocol.invocation(input.args);
  const events = await input.store.listRunEvents(input.run.id);
  const resultCandidates = events
    .filter((event) => event.type === "context.tool_result")
    .map((event) => {
      try {
        return {
          event,
          receipt: validateToolInvocationResultCapsuleReceipt(event.payload),
        };
      } catch {
        return undefined;
      }
    })
    .filter(isDefined)
    .filter((candidate) => candidate.receipt.callId === input.callId);
  if (
    new Set(
      resultCandidates.map((candidate) => candidate.receipt.contentSha256),
    ).size > 1
  ) {
    return { disposition: "not_repairable" };
  }
  const resultEvidence = resultCandidates.find(
    (candidate) =>
      candidate.receipt.contentSha256 === captured.resultEvidenceSha256,
  );
  const receipt = resultEvidence?.receipt;
  const invocationCandidates = events
    .filter((event) => event.type === "context.tool_invocation")
    .map((event) => {
      try {
        return validateToolInvocationCapsuleReceipt(event.payload);
      } catch {
        return undefined;
      }
    })
    .filter(isDefined)
    .filter((candidate) => candidate.callId === input.callId);
  if (
    new Set(invocationCandidates.map((candidate) => candidate.contentSha256))
      .size > 1
  ) {
    return { disposition: "not_repairable" };
  }
  const invocationReceipt = invocationCandidates.find(
    (candidate) => candidate.capsuleSha256 === receipt?.invocationCapsuleSha256,
  );
  if (
    !receipt ||
    !invocationReceipt ||
    receipt.toolName !== input.toolName ||
    !input.protocol.matchesReplayIdentitySha256(receipt.toolDefinitionSha256) ||
    receipt.argumentsSha256 !== toolInvocationArgumentsSha256(input.args) ||
    receipt.isError !== captured.isError ||
    receipt.resultSha256 !== toolInvocationResultSha256(captured.result)
  ) {
    return { disposition: "not_repairable" };
  }
  const operation = await executionAuthorityOperation(input, invocation);
  return operation.repairSettled({
    settlement: resultSettlement(input, captured.result, captured.isError),
    resultEvidenceSha256: captured.resultEvidenceSha256,
    resultEvidenceEventSeq: resultEvidence!.event.seq,
  });
}

export async function reconcileCapturedToolExecutionResult(
  input: DurableToolExecutionClaimInput,
  disposition: ToolExecutionReplayDisposition,
  captured: CapturedToolExecutionResult,
): Promise<boolean> {
  if (!canReconcileCapturedToolExecutionResult(disposition)) return false;
  const decision = await repairDurableToolExecutionFromCapturedResult(
    input,
    captured,
  );
  if (disposition === "terminal_replay") {
    return decision.disposition === "terminal_replay";
  }
  return (
    decision.disposition === "repaired" ||
    decision.disposition === "terminal_replay"
  );
}

export class DurableToolExecutionLease {
  private started = false;
  private settled = false;
  private revoked = false;

  constructor(
    private readonly input: DurableToolExecutionClaimInput,
    private readonly operation: ToolOperationLifecycle,
  ) {}

  async start(payload: Record<string, JsonValue>): Promise<void> {
    this.assertOpen();
    await this.operation.started();
    this.started = true;
    await appendPhase(
      this.input,
      "tool.started",
      {
        ...payload,
        callId: this.input.callId,
        toolName: this.input.toolName,
        status: "started",
      },
      "user",
    );
  }

  async settleResult(
    result: AgentToolResult<unknown>,
    isError = false,
    failure?: ToolFailureReceiptV1,
  ): Promise<void> {
    this.assertOpen();
    if (!this.started) {
      throw new Error(
        `Tool call ${this.input.callId} cannot settle before it starts`,
      );
    }
    await this.operation.settled(
      resultSettlement(this.input, result, isError, failure),
    );
    this.settled = true;
  }

  async effectBoundary(): Promise<void> {
    this.assertOpen();
    if (!this.started) {
      throw new Error(
        `Tool call ${this.input.callId} cannot enter its effect boundary before it starts`,
      );
    }
    try {
      await this.operation.effectBoundary();
    } catch (error) {
      this.revoked = error instanceof ToolOperationFencingError;
      throw error;
    }
  }

  async fail(error: unknown): Promise<void> {
    if (this.settled || this.revoked) return;
    const failure = this.input.protocol.failure?.(this.input.args, error);
    await this.operation.settled({
      outcome: this.started ? "failed" : "skipped",
      ...(failure ? { failure } : {}),
      diagnostic: error,
      effect: phaseFailureEffect(
        this.input.callId,
        this.started ? "execution" : "before_start",
      ),
    });
    this.settled = true;
  }

  private assertOpen(): void {
    if (this.settled || this.revoked) {
      throw new Error(`Tool call ${this.input.callId} is already settled`);
    }
  }
}

async function executionAuthorityOperation(
  input: DurableToolExecutionClaimInput,
  invocation: ToolInvocationProtocolV2,
): Promise<ToolOperationLifecycle> {
  const journal = new DurableToolOperationJournal(
    input.store,
    { threadId: input.run.threadId, runId: input.run.id },
    input.journalOptions,
  );
  const legacyOperation = journal
    .observer(input.callId)
    .operation(
      legacyToolExecutionAuthorityDescriptor(input.toolName, invocation),
    );
  const hasLegacyAuthority = (
    await input.store.listRunEvents(input.run.id)
  ).some((event) => {
    const payload =
      event.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload)
        ? event.payload
        : undefined;
    return (
      event.type.startsWith("tool.operation.") &&
      payload?.["operationId"] === legacyOperation.operationId
    );
  });
  return hasLegacyAuthority
    ? legacyOperation
    : journal
        .observer(input.callId)
        .operation(
          toolExecutionAuthorityDescriptor(input.toolName, invocation),
        );
}

function resultSettlement(
  input: DurableToolExecutionClaimInput,
  result: AgentToolResult<unknown>,
  isError: boolean,
  failure?: ToolFailureReceiptV1,
): ToolOperationSettlement {
  const progress = input.protocol.progress(input.args, result, isError);
  const output = agentToolResultText(result);
  return {
    outcome: isError ? "failed" : "succeeded",
    ...(isError
      ? {
          ...(failure ? { failure } : {}),
          diagnostic: output,
          details: result.details,
        }
      : {}),
    ...(progress.stateSha256 ? { state: progress.stateSha256 } : {}),
    effect: toolExecutionResultEffect(input.callId, result, isError, output),
  };
}

function phaseFailureEffect(
  callId: string,
  phase: string,
): Record<string, JsonValue> {
  return {
    kind: "napier.tool-execution-effect",
    schemaVersion: 1,
    callId,
    outcome: "failed",
    phase,
  };
}

async function appendPhase(
  input: DurableToolExecutionClaimInput,
  type: "tool.admitted" | "tool.started",
  payload: Record<string, JsonValue>,
  visibility: "debug" | "user",
  idempotency: { namespace: string; key: string } = {
    namespace: "durable-tool-execution-phase",
    key: `${input.run.id}:${input.callId}:${type}`,
  },
): Promise<RunEvent> {
  const eventInput = {
    threadId: input.run.threadId,
    runId: input.run.id,
    type,
    category: "tool",
    visibility,
    payload,
  } as AppendEventInput;
  const receipt = await claimRunHeadEvent(input.store, eventInput, idempotency);
  if (receipt.appended) {
    await emitBestEffort(input.onEvent, receipt.event);
  }
  return receipt.event;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
