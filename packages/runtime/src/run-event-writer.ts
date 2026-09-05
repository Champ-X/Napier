import type {
  RunEvent,
  RunEventAdmissionPolicyV1,
  ThreadRecord,
} from "@napier/contracts";

import { assertArtifactReceiptEventBoundary } from "./artifact-receipts.js";
import {
  type EventIdempotencyKey,
  type IdempotentRunEvent,
  withEventIdempotency,
} from "./event-idempotency.js";
export type {
  EventIdempotencyKey,
  IdempotentRunEvent,
} from "./event-idempotency.js";
import { createId, nowIso } from "./ids.js";
import {
  assertRunEventAdmission,
  terminalRunStatusFromEventType,
  type TerminalRunStatus,
} from "./run-event-admission.js";
import {
  resolveRegisteredEventInput,
  type AppendEventInput,
  type ResolvedRunEventInput,
} from "./run-event-registry.js";
import { applyThreadSummaryEvent } from "./store-thread-summary-projection.js";

export interface RunEventWriterHost {
  runStatus(runId: string):
    | {
        threadId: string;
        status:
          | "queued"
          | "running"
          | "completed"
          | "failed"
          | "cancelled"
          | "interrupted";
      }
    | undefined;
  terminalRunStatus(
    threadId: string,
    runId: string,
  ): TerminalRunStatus | undefined;
  mutableThread(threadId: string): ThreadRecord;
  runInThreadQueue<T>(
    threadId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
  runInStateQueue<T>(operation: () => Promise<T>): Promise<T>;
  persistEvent(event: RunEvent): Promise<void>;
  validateResourceId(id: string): void;
}

export interface RunEventOnceWriterHost extends RunEventWriterHost {
  persistEventOnce(
    event: IdempotentRunEvent,
    idempotency: EventIdempotencyKey,
    admission: RunEventAdmissionPolicyV1,
  ): Promise<{ event: RunEvent; appended: boolean }>;
}

export interface RunEventOnceAtRunHeadWriterHost extends RunEventOnceWriterHost {
  persistEventOnceAtRunHead(
    event: IdempotentRunEvent,
    idempotency: EventIdempotencyKey,
    expectedRunHeadSeq: number,
    admission: RunEventAdmissionPolicyV1,
  ): Promise<RunEventAppendResult>;
}

export interface RunEventAppendResult {
  event: RunEvent;
  appended: boolean;
}

export async function appendResolvedRunEvent(
  host: RunEventWriterHost,
  input: ResolvedRunEventInput,
): Promise<RunEvent> {
  host.validateResourceId(input.threadId);
  return host.runInThreadQueue(input.threadId, () =>
    host.runInStateQueue(async () => {
      assertResolvedRunEventAdmissions([input], host);
      const [event] = appendResolvedEventsToThread(
        host.mutableThread(input.threadId),
        [input],
      );
      if (!event) throw new Error("Ledger event was not created");
      await host.persistEvent(event);
      return structuredClone(event);
    }),
  );
}

export async function appendResolvedRunEventOnce(
  host: RunEventOnceWriterHost,
  input: ResolvedRunEventInput,
  idempotency: EventIdempotencyKey,
): Promise<RunEvent> {
  host.validateResourceId(input.threadId);
  return host.runInThreadQueue(input.threadId, () =>
    host.runInStateQueue(async () => {
      // Idempotent replay must win before lifecycle admission. The SQLite
      // transaction fences only a genuinely new lifecycle-constrained event.
      const [candidate] = appendResolvedEventsToThread(
        host.mutableThread(input.threadId),
        [input],
        { idempotency },
      );
      if (!candidate) throw new Error("Ledger event was not created");
      const result = await host.persistEventOnce(
        candidate as IdempotentRunEvent,
        idempotency,
        input.admission ?? "run_any",
      );
      return structuredClone(result.event);
    }),
  );
}

export async function appendResolvedRunEventOnceAtRunHead(
  host: RunEventOnceAtRunHeadWriterHost,
  input: ResolvedRunEventInput,
  idempotency: EventIdempotencyKey,
  expectedRunHeadSeq: number,
): Promise<RunEventAppendResult> {
  host.validateResourceId(input.threadId);
  assertExpectedRunHeadSeq(expectedRunHeadSeq);
  return host.runInThreadQueue(input.threadId, () =>
    host.runInStateQueue(async () => {
      // Run-head claims resolve idempotent replay before lifecycle admission
      // inside the SQLite transaction. An in-memory check here would make a
      // replay depend on whether this facade had already refreshed its Run.
      const [candidate] = appendResolvedEventsToThread(
        host.mutableThread(input.threadId),
        [input],
        { idempotency },
      );
      if (!candidate) throw new Error("Ledger event was not created");
      const result = await host.persistEventOnceAtRunHead(
        candidate as IdempotentRunEvent,
        idempotency,
        expectedRunHeadSeq,
        input.admission ?? "run_any",
      );
      return structuredClone(result);
    }),
  );
}

export function appendRegisteredEventsToThread(
  thread: ThreadRecord,
  inputs: readonly AppendEventInput[],
  options: {
    createdAt?: string;
    admission: Pick<RunEventWriterHost, "runStatus" | "terminalRunStatus">;
  },
): RunEvent[] {
  if (!options?.admission) {
    throw new Error("Registered event batch admission context is required");
  }
  const resolved = inputs.map(resolveRegisteredEventInput);
  // Validate the complete batch before mutating the Thread projection. This
  // makes the repository batch path obey the same per-event lifecycle policy
  // as appendEvent and prevents a rejected tail event from partially applying
  // earlier summary mutations.
  assertResolvedRunEventAdmissions(resolved, options.admission);
  return appendResolvedEventsToThread(thread, resolved, options);
}

/**
 * Bootstrap-only boundary used before the seed Run projection or ledger
 * exists. Runtime repository writers must use appendRegisteredEventsToThread.
 */
export function appendWorkspaceSeedEventsToThread(
  thread: ThreadRecord,
  inputs: readonly AppendEventInput[],
  options: { createdAt?: string } = {},
): RunEvent[] {
  return appendResolvedEventsToThread(
    thread,
    inputs.map(resolveRegisteredEventInput),
    options,
  );
}

function assertResolvedRunEventAdmissions(
  inputs: readonly ResolvedRunEventInput[],
  host: Pick<RunEventWriterHost, "runStatus" | "terminalRunStatus">,
): void {
  const batchTerminalStatus = new Map<string, TerminalRunStatus>();
  for (const input of inputs) {
    const key = `${input.threadId}\u0000${input.runId}`;
    const terminalStatus =
      batchTerminalStatus.get(key) ??
      host.terminalRunStatus(input.threadId, input.runId);
    assertRunEventAdmission(input, host.runStatus(input.runId), terminalStatus);
    const appendedTerminalStatus = terminalRunStatusFromEventType(input.type);
    if (appendedTerminalStatus && !terminalStatus) {
      batchTerminalStatus.set(key, appendedTerminalStatus);
    }
  }
}

function appendResolvedEventsToThread(
  thread: ThreadRecord,
  inputs: readonly ResolvedRunEventInput[],
  options: {
    createdAt?: string;
    idempotency?: EventIdempotencyKey;
  } = {},
): RunEvent[] {
  return inputs.map((input) => {
    if (input.threadId !== thread.id) {
      throw new Error("Ledger event Thread does not match mutable projection");
    }
    const baseEvent: RunEvent = {
      id: createId("event"),
      threadId: input.threadId,
      runId: input.runId,
      seq: thread.eventCount + 1,
      type: input.type,
      category: input.category,
      visibility: input.visibility,
      createdAt: options.createdAt ?? nowIso(),
      payload: input.payload,
      schemaVersion: input.schemaVersion,
    };
    const event = options.idempotency
      ? withEventIdempotency(baseEvent, options.idempotency)
      : baseEvent;
    assertArtifactReceiptEventBoundary(event, `Ledger event ${input.type}`);
    applyThreadSummaryEvent(thread, event);
    return event;
  });
}

function assertExpectedRunHeadSeq(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "Expected Run event head sequence must be a non-negative safe integer",
    );
  }
}
