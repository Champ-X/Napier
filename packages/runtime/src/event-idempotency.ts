import type { RunEvent } from "@napier/contracts";

import { canonicalJson } from "./ed25519.js";
import type { AppendEventInput } from "./run-event-registry.js";
import {
  retryCasConflict,
  type CasConflictRetryOptions,
} from "./cas-conflict-retry.js";
import { ConcurrentRunEventHeadError } from "./sqlite-ledger-errors.js";

export interface EventIdempotencyKey {
  namespace: string;
  key: string;
}

export interface IdempotentRunEvent extends RunEvent {
  idempotency: EventIdempotencyKey;
}

export interface RunHeadEventClaimStore {
  appendEventOnceAtRunHead(
    input: AppendEventInput,
    options: EventIdempotencyKey & { expectedRunHeadSeq: number },
  ): Promise<{ event: RunEvent; appended: boolean }>;
  listRunEvents(runId: string): Promise<RunEvent[]>;
}

export class IdempotentEventConflictError extends Error {
  override readonly name = "IdempotentEventConflictError";

  constructor(readonly eventType: string) {
    super(
      `Ledger event idempotency conflict: ${eventType} does not match the committed event`,
    );
  }
}

const NAMESPACE_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const MAX_KEY_LENGTH = 512;

export function normalizeEventIdempotencyKey(
  input: EventIdempotencyKey,
): EventIdempotencyKey {
  if (!NAMESPACE_PATTERN.test(input.namespace)) {
    throw new Error(
      "Event idempotency namespace must be a stable lowercase identifier",
    );
  }
  if (
    input.key.length < 1 ||
    input.key.length > MAX_KEY_LENGTH ||
    input.key.trim() !== input.key ||
    /[\u0000-\u001f\u007f]/u.test(input.key)
  ) {
    throw new Error(
      `Event idempotency key must contain 1-${String(MAX_KEY_LENGTH)} non-control characters`,
    );
  }
  return { namespace: input.namespace, key: input.key };
}

export function withEventIdempotency(
  event: RunEvent,
  input: EventIdempotencyKey,
): IdempotentRunEvent {
  return {
    ...event,
    idempotency: normalizeEventIdempotencyKey(input),
  };
}

export function eventIdempotencyKey(
  event: RunEvent,
): EventIdempotencyKey | undefined {
  const value = (event as RunEvent & { idempotency?: unknown }).idempotency;
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    typeof value["namespace"] !== "string" ||
    typeof value["key"] !== "string"
  ) {
    throw new Error("Ledger event idempotency metadata is invalid");
  }
  return normalizeEventIdempotencyKey({
    namespace: value["namespace"],
    key: value["key"],
  });
}

/**
 * An idempotency key identifies one semantic event, not merely one write slot.
 * Reusing it with different content is a split-brain signal and must fail
 * closed instead of silently returning the first writer's unrelated event.
 */
export function assertIdempotentEventReplay(
  existing: RunEvent,
  candidate: RunEvent,
): void {
  const semantic = (event: RunEvent) => ({
    threadId: event.threadId,
    runId: event.runId,
    type: event.type,
    category: event.category,
    visibility: event.visibility,
    payload: event.payload,
    schemaVersion: event.schemaVersion,
  });
  if (
    canonicalJson(semantic(existing)) !== canonicalJson(semantic(candidate))
  ) {
    throw new IdempotentEventConflictError(candidate.type);
  }
}

/**
 * Appends one semantic event against the current durable Run head.
 *
 * Head contention is transport-level concurrency and is retried. Reusing the
 * same key for different semantic content remains an
 * IdempotentEventConflictError and is deliberately never retried.
 */
export async function claimRunHeadEvent(
  store: RunHeadEventClaimStore,
  input: AppendEventInput,
  idempotency: EventIdempotencyKey,
  retryOptions: Readonly<CasConflictRetryOptions> | number = {},
): Promise<{ event: RunEvent; appended: boolean }> {
  const options =
    typeof retryOptions === "number"
      ? { maxAttempts: retryOptions }
      : retryOptions;
  return retryCasConflict({
    operation: async () => {
      const events = await store.listRunEvents(input.runId);
      const expectedRunHeadSeq = events.reduce(
        (head, event) => Math.max(head, event.seq),
        0,
      );
      return await store.appendEventOnceAtRunHead(input, {
        ...idempotency,
        expectedRunHeadSeq,
      });
    },
    isConflict: (error) => error instanceof ConcurrentRunEventHeadError,
    exhaustedMessage: `Ledger event claim ${idempotency.namespace}/${idempotency.key} was contended`,
    options,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
